# Design: FX Rate Cache Validation

## Technical Approach

Extract `fetchJson`, `_fxCache` and `fetchFxRate` from `app.js:105-128` into one new DOM-free module, `fx.js`, gate the cache write on a strict numeric check, and gate `fetchJson` on `res.ok`. `app.js` imports the module; both call sites (`app.js:222`, `app.js:1084`) keep their exact current shape. The module becomes the first unit under `node:test`. This delta extends the existing `price-refresh-reliability` capability: its "Truthful Freshness Stamp" requirement forbids a false signal from being persisted to `lastPriceUpdate`; the same rule is now applied to `_fxCache`.

## Architecture Decisions

### Decision: One module, `fx.js`, holding `fetchJson` + `_fxCache` + `fetchFxRate`

| Option | Tradeoff | Decision |
|---|---|---|
| `fx.js` with all three | Slightly broad name; keeps the repo at 5 flat source files | **Chosen** |
| `http.js` + `fx.js` | Two files for ~30 lines; fragments a 4-file repo | Rejected |
| Move only `fetchFxRate` | `fx.js` would have to import `fetchJson` from `app.js`, which is unimportable in Node (`app.js:548-563` top-level `document.*`) and would be circular | Rejected — not viable |

**Rationale**: the repo splits by responsibility (`store` / `drive` / `sw` / `app`) and has no utility module; `fx.js` is a fifth responsibility — outbound HTTP for the price-refresh flow — not a grab-bag. `fetchJson` must move because it is `fetchFxRate`'s dependency. `fetchPrices` keeps working by importing the same symbol (`app.js:192`, `app.js:218`). Nothing touching `store` or the DOM moves.

### Decision: plain `.js`, not `.mjs`

**Choice**: `fx.js` and `fx.test.js`, matching `store.js`, `drive.js`, `sw.js`, `app.js`.
**Alternatives**: `.mjs` (rejected — see below); adding `package.json` with `"type": "module"` (rejected — `openspec/config.yaml` line 36 forbids introducing a package manager unless explicitly requested).
**Rationale**: Node enables automatic module-syntax detection by default since v22.7, and this machine runs v24.18.0. A `.js` file containing `import` is therefore loaded as ESM with no `package.json` — verified empirically (`node --test` on a `.js` test importing a `.js` module in a directory with no `package.json`: `pass 1 fail 0`). The earlier `.mjs` premise, that such a file would parse as CommonJS, is outdated.

`.js` also removes a live production risk rather than merely mitigating it. The app is served by GitHub Pages from the `master` branch root at `http://luisgonzalezbernal.com/net-worth-tracker/`. Browsers dispatch modules on the served `Content-Type`, not the extension; an `.mjs` served as `application/octet-stream` would have been a boot failure in production. The host already serves `app.js` and `store.js` correctly, so `fx.js` introduces nothing new to verify.

**Tradeoff accepted in its place**: the test suite now requires **Node >= 22.7**. The repo declares no minimum Node version anywhere — no `package.json`, no `.nvmrc`, no CI. Below 22.7 the suite fails with a confusing syntax error rather than a version message, so this MUST be documented.
**Where to document** (both, for `sdd-tasks`): a line in the `context:` block of `openspec/config.yaml`, which `sdd-tasks` is already editing to set `test_command`, so it is free; and a one-line comment at the top of `fx.test.js`, where the failure actually bites. **Rejected**: adding `.nvmrc` — it pins an exact version, implies `nvm`, and introduces a tooling convention to a repo that has none, for a constraint that only affects developers running tests, never the browser.

### Decision: `fetchJson` rejects on non-`ok`

**Choice**: `if (!res.ok) throw new Error(\`HTTP ${res.status}\`)` before `res.json()`.
**Alternatives**: return `null` (every caller needs a new guard, and the undefined-property path we are removing returns); return `{ ok, data }` (reshapes 3 call sites for no gain, un-idiomatic here).
**Rationale**: every `fetchJson` caller is already inside a `try/catch` — CoinGecko at `app.js:191-204` (`failed += cryptoAssets.length`), Alpha Vantage per-asset at `app.js:217-230` (`failed++`), and `fetchFxRate` itself at `app.js:121-126` (`return 1`). `res.json()` can already reject, so callers tolerate this failure class today; rejecting on non-`ok` only makes an error body fail earlier and explicitly instead of as a downstream `undefined`.

### Decision: the numeric contract stays; only the cache is gated

**Choice**: `fetchFxRate` still always resolves to a number and never throws. Cache stores **only validated rates**; the `1` fallback is returned but never written.
**Alternatives**: return `null`/`undefined` for "no rate" (`price * null` = `0` at `app.js:223`, `initialValue * null` = `0` at `app.js:1085` — strictly worse than `1`); throw (forbidden, see below); add a parallel `{ rate, ok }` API (unused until the follow-up exists).
**Rationale**: the reported defect is *stickiness* — one bad response fixing a pair at 1:1 for the whole session. Gating the write removes it; a later call for the same pair re-fetches and gets the real rate.

**Never-throws obligation — verified**: `fetchJson`'s new rejection is raised inside the existing `try` at `app.js:121`, whose `catch` returns `1`. No new throw site is added outside that `try`. `app.js:1084` sits in `formAsset.addEventListener('submit', ...)` (`app.js:1054`) with no `try/catch` between, so `store.addTransaction(...)` at `app.js:1088` still runs. Caller 1 at `app.js:222` is more tolerant (its `catch` counts `failed++`), so the stricter contract satisfies both.

**Validation predicate**: `Number.isFinite(rate) && rate > 0`. `typeof rate === 'number'` admits `NaN` (poisons an amount) and `±Infinity`; `0` zeroes a position and a negative rate flips its sign — neither is a possible exchange rate. `Number.isFinite` does not coerce, so a string `"1.08"` is rejected: a provider format change then falls back loudly instead of caching a non-number.

**Spec reconciliation**: the delta spec's bar is "a validated, finite, non-zero numeric rate". `Number.isFinite(rate) && rate > 0` is strictly narrower — it additionally excludes negatives — and therefore satisfies it. No contradiction; `sdd-tasks` does not need to re-derive this. The spec's "legitimate 1:1 rate between distinct currencies" scenario is satisfied because `1 > 0` and `1` is finite, so a genuine parity rate is cached like any other.

**Same-currency short-circuit**: unchanged and confirmed — `if (from === to) return 1` runs before the cache read and before any `fetch`, so zero network calls.

**In scope vs follow-up**: `txExtra = { fxRate: rate }` at `app.js:1086` recording a fallback `1` as a real rate, and `amountEur = initialValue * 1` persisting a foreign amount as EUR at par, is a **follow-up**, not this change. Fixing it requires a product decision about what the submit UI does when no rate is available (block, warn, or store unconverted), which neither the proposal nor this delta scopes.

### Decision: this change touches NO service-worker file

**`sw.js` is out of scope and is not modified.** No precache entry is added for `fx.js` and `CACHE_NAME` is not bumped. A reviewer reading the diff should expect to see no `sw.js` line at all.

**Rationale**: the service worker never installs in this deployment, so editing its precache list changes nothing. `PRECACHE_URLS` (`sw.js:2-10`) uses site-root-absolute paths while the app is served from a GitHub Pages subpath, so every entry 404s and `cache.addAll` rejects — see Follow-up A for the full evidence. Adding one more inert entry to an inert list would be a change with no observable effect, presented in the diff as if it were a fix. An earlier revision of this design argued the opposite; that reasoning is withdrawn.

`fx.js` is a new eager top-level import on the boot path, so it inherits exactly the same offline behaviour as `drive.js` and `store.js` do today — which is the behaviour of an app with no working service worker. This change neither improves nor degrades it.

## Data Flow

    app.js fetchPrices ─┐
                        ├─→ fx.js fetchJson ──(!res.ok → reject)──→ caller catch
    app.js submit ──→ fetchFxRate ─→ same-currency? → 1 (no fetch)
                                   → cache hit? → validated rate
                                   → fetchJson → valid? → cache + return
                                                → else  → return 1, no cache write

## File Changes

| File | Action | Description |
|---|---|---|
| `fx.js` | Create | `fetchJson`, private `_fxCache`, `fetchFxRate`, `resetFxCache` (test seam) |
| `fx.test.js` | Create | `node:test` suite, mocked global `fetch`; header comment noting Node >= 22.7 |
| `app.js` | Modify | Delete `105-128`; add `import { fetchJson, fetchFxRate } from './fx.js';` beside the existing `./store.js` import (`app.js:1`). Call sites `192`, `218`, `222`, `1084` unchanged |
| `openspec/config.yaml` | Modify (by `sdd-tasks`, not here) | `rules.apply.test_command` and `rules.verify.test_command` → `node --test`; note Node >= 22.7 in `context:` |
| `sw.js`, `index.html`, `store.js`, `drive.js`, `style.css` | Unchanged | Explicitly including `sw.js` — see the decision above |

## Interfaces / Contracts

```js
// fx.js
export const fetchJson = async (url, timeoutMs) => { /* aborts on timeout; rejects on !res.ok */ };
export const fetchFxRate = async (from, to = 'EUR') => { /* always resolves to a positive finite number; NEVER throws */ };
export const resetFxCache = () => { /* clears module cache; tests only */ };
```

## Testing Strategy

Run with **`node --test fx.test.js`** (bare `node --test` also discovers it). Requires Node >= 22.7. No runner, dependency or build step is added.

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Same-currency returns `1` with `fetch` call count `0` | `mock.method(globalThis, 'fetch', ...)`, assert `callCount() === 0` |
| Unit | Valid rate returned, then served from cache on a second call (one fetch) | mocked ok response |
| Unit | A genuine `1` between distinct currencies IS cached and reused | spec scenario; guards against over-correcting the fix |
| Unit | **Missing `rates[to]` returns `1` and is NOT cached**; the next successful call returns the real rate | two sequential mock responses — the headline regression |
| Unit | Non-`ok` response with a JSON body returns `1` and is not cached | `{ ok: false, status: 429, json: async () => ({...}) }` |
| Unit | `0`, negative, `NaN`, `Infinity`, `"1.08"` are never cached | table-driven |
| Unit | Rejected/aborted `fetch` returns `1` and never throws | mock rejects |
| Unit | `fetchJson` rejects on non-`ok`, resolves parsed JSON on `ok` | direct calls |
| Manual | Browser smoke: app loads, foreign-currency asset refresh converts | `index.html:666` unchanged |

`resetFxCache()` runs in `beforeEach`; `mock.restoreAll()` in `afterEach`. Not tested: the abort wall-clock (covered by the existing spec's manual scenarios), `fetchPrices`, DOM, `app.js`, service-worker behaviour (no `sw.js` change is made).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. `node --test` is a developer command, not product process integration.

## Migration / Rollout

No migration required. No service-worker migration, no cache-version bump, no data migration: no localStorage, storage schema or FX cache key changes. Roll back by reverting the commit.

## Open Questions

- [ ] **Follow-up A — UNFIXED PRODUCTION DEFECT: the service worker never installs.** `PRECACHE_URLS` (`sw.js:2-10`) uses site-root-absolute paths (`'/'`, `'/index.html'`, `'/app.js'`, ...) while the app is deployed to a GitHub Pages **subpath** (`http://luisgonzalezbernal.com/net-worth-tracker/`; `gh api repos/iamluisgb/net-worth-tracker/pages` → status `built`, source branch `master`, path `/`). Those paths resolve against the domain root. Measured: `http://luisgonzalezbernal.com/app.js` → 301 → `https://luisgonzalezbernal.com/app.js` → **404**, while `http://luisgonzalezbernal.com/net-worth-tracker/app.js` → **200 `application/javascript; charset=utf-8`**. `cache.addAll()` rejects if any request fails, and that rejection propagates through `e.waitUntil()` in the install handler (`sw.js:12-17`), so install fails and the worker never activates. Registration itself is correct — `navigator.serviceWorker.register('./sw.js')` at `app.js:1834` is relative and yields the proper `/net-worth-tracker/` scope. **Fix direction**: make the precache paths relative (`'./'`, `'./index.html'`, `'./app.js'`, ...) so they resolve against the worker's scope; the fetch handler's offline fallback `caches.match('/index.html')` at `sw.js:49` carries the same root-absolute bug. **Needs its own SDD cycle**, not a one-line tweak: fixing it makes the app offline-capable for the first time, which is a behaviour change requiring its own spec and verification.
  - **Downstream of A**: `drive.js` is imported eagerly at `app.js:2-6` but is absent from `PRECACHE_URLS`, and `fx.js` will be in the same position. That is a real defect, but it is unreachable until installation works — the app does not fail offline *because* `drive.js` is missing; it never gets that far. Fold into the same cycle.
- [ ] **Follow-up B**: stop recording a fallback `1` as a real `fxRate` at `app.js:1086`.
