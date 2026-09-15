# Tasks: FX Rate Cache Validation

Convention: `.claude/skills/_shared/openspec-convention.md`. Grouped by phase, hierarchical numbering, each task independently checkable and traceable to a spec requirement or design decision.

**Ordering constraint**: Phase 1 (extraction, no behaviour change) MUST land before Phase 2 (behavioural edits). This keeps the diff reviewable — a reviewer can confirm Phase 1 moved code unchanged before evaluating Phase 2's logic changes on top of it. Phase 3 (tests) depends on Phase 1's exports but is independent of Phase 2's internal gating logic being reviewed separately, since the tests exercise the gated behaviour directly. Phase 4 (config/docs) is independent of 1-3 and parallelizable with any of them.

## Phase 1 — Extraction (no behaviour change)

Moves `app.js:105-128` verbatim into a new module. No logic changes in this phase — a reviewer diffing this phase alone should see a deletion in `app.js` and an addition in `fx.js` with matching bodies.

- [x] **1.1** Create `fx.js` at the repo root containing `fetchJson` and `_fxCache`/`fetchFxRate` copied verbatim from `app.js:105-128`, each as a named `export`. No logic changes yet — this is a pure move.
  - Traces to: design "Decision: One module, `fx.js`, holding `fetchJson` + `_fxCache` + `fetchFxRate`"; design "Decision: plain `.js`, not `.mjs`"
  - Depends on: none
  - Parallelizable with: 4.1, 4.2

- [x] **1.2** Add `export const resetFxCache = () => { ... clears _fxCache ... };` to `fx.js`. Test-only seam, not called from `app.js`.
  - Traces to: design "Interfaces / Contracts" (`resetFxCache`); design Testing Strategy (`beforeEach` reset)
  - Depends on: 1.1

- [x] **1.3** In `app.js`, delete lines 105-128 (the `// --- FX / Multi-currency ---` block through the closing brace of `fetchFxRate`) and add `import { fetchJson, fetchFxRate } from './fx.js';` beside the existing `./store.js` import at `app.js:1`.
  - Traces to: design "File Changes" table (`app.js` row); proposal "Affected Areas" (`app.js:103-128` Removed)
  - Depends on: 1.1
  - Verify: call sites at `app.js:192`, `app.js:218`, `app.js:222`, `app.js:1084` (line numbers shift after the deletion — re-locate by content, not by number) are textually unchanged, since they already reference `fetchJson`/`fetchFxRate` by name.

- [x] **1.4** Browser smoke check: open `index.html` directly (or via a static file server) with DevTools console open, confirm the app boots with no module-resolution or console errors, and that `fx.js` loads as a network request. This is the acceptance criterion for "no bundler resolves the new import" — a broken relative import path would silently fail module load in a browser with no build step to catch it.
  - Traces to: proposal Risks ("Extraction breaks module load in the browser (no bundler)"); proposal Success Criteria (manual browser smoke test, first half — load only, no FX assertion yet since Phase 2 hasn't landed)
  - Depends on: 1.3
  - Manual, proportional: this is a load-only check (app boots, no console error), not the full conversion-correctness smoke test — that is deferred to 3.6 once the gating logic exists.

## Phase 2 — Behavioural edits (in `fx.js`, post-extraction)

Applied only to the already-extracted `fx.js`, never to `app.js`. Sequential after Phase 1 so each edit is reviewable against a stable baseline.

- [x] **2.1** In `fx.js`'s `fetchJson`, add `if (!res.ok) throw new Error(\`HTTP ${res.status}\`);` before `res.json()` is called (i.e. right after the `fetch()` resolves, before parsing the body).
  - Traces to: spec "Requirement: Non-OK HTTP Responses Are Never Treated as Successful Data" (both scenarios); design "Decision: `fetchJson` rejects on non-`ok`"
  - Depends on: 1.1

- [x] **2.2** In `fx.js`'s `fetchFxRate`, replace the unconditional cache write `_fxCache[key] = data.rates?.[to] || 1;` with a validated write: compute `const rate = data.rates?.[to];`, write to `_fxCache[key]` only when `Number.isFinite(rate) && rate > 0`, and return the fallback `1` (without caching it) when the check fails.
  - Traces to: spec "Requirement: FX Rate Cache Only Stores Validated Numeric Rates" (all four scenarios); design "Decision: the numeric contract stays; only the cache is gated" (validation predicate `Number.isFinite(rate) && rate > 0`)
  - Depends on: 1.1, 2.1 (shares the same function body region; sequencing avoids overlapping edits to the same lines)

- [x] **2.3** Confirm (read-only, no code change) that `fetchFxRate`'s existing `try/catch` around the `fetchJson` call still wraps the new `throw` from 2.1 and the return-`1` path from 2.2, so `fetchFxRate` never throws to its callers. Confirm the same-currency short-circuit (`if (from === to) return 1;`) still runs before the cache read and before any `fetchJson` call, unaffected by 2.1/2.2.
  - Traces to: spec "Scenario: fetchFxRate never throws to its callers regardless of response validity"; spec "Scenario: Same-currency requests never hit the network or the cache-validation path"; design "Never-throws obligation — verified"
  - Depends on: 2.1, 2.2
  - This is a structural readback task, not a code edit — record the confirmation in the PR description or commit message.

## Phase 3 — Automated tests (`fx.test.js`)

All parallelizable with each other once 1.1/1.2/2.1/2.2 exist (all read the same finished `fx.js`); sequential only in that they all depend on Phase 1 and Phase 2 being complete. Runner: `node --test fx.test.js` (bare `node --test` also discovers it). `resetFxCache()` in `beforeEach`, `mock.restoreAll()` in `afterEach`.

- [x] **3.1** Header comment in `fx.test.js` noting the Node >= 22.7 requirement for automatic ESM detection in a `.js` file (see design "Tradeoff accepted in its place").
  - Traces to: design "Decision: plain `.js`, not `.mjs`" ("Where to document")
  - Depends on: 1.1

- [x] **3.2** Test: same-currency call returns `1` with zero `fetch` calls (`mock.method(globalThis, 'fetch', ...)`, assert `callCount() === 0`).
  - Traces to: spec "Scenario: Same-currency requests never hit the network or the cache-validation path"

- [x] **3.3** Test: a valid numeric rate is returned on first call and served from cache on a second call for the same pair (exactly one `fetch` call total).
  - Traces to: spec "Scenario: A genuine numeric rate is cached and reused"

- [x] **3.4** Test: a genuine `1` rate between two distinct currencies IS cached and reused (guards against over-correcting the truthiness fix into rejecting the legitimate value `1`).
  - Traces to: spec "Scenario: A legitimate 1:1 rate between distinct currencies is cached like any other rate"

- [x] **3.5** Test: a missing/absent `rates[to]` response returns `1` and is NOT cached; a second sequential mocked call for the same pair with a valid rate then succeeds and caches correctly. This is the headline regression test for the defect described in the proposal.
  - Traces to: spec "Scenario: A malformed FX response body is not cached"; spec "Scenario: A bad response does not poison later legitimate calls"; proposal Intent (stickiness defect)

- [x] **3.6** Test: a non-`ok` response (e.g. `{ ok: false, status: 429, json: async () => ({...}) }`) with a JSON body returns `1` and is not cached.
  - Traces to: spec "Scenario: A non-ok response with a JSON error body is not treated as success"

- [x] **3.7** Test: table-driven — `0`, a negative number, `NaN`, `Infinity`, and the string `"1.08"` are each returned as the mocked `rates[to]` value and none of them is ever cached.
  - Traces to: spec "Requirement: FX Rate Cache Only Stores Validated Numeric Rates" (validity bar); design "Validation predicate" rationale (excludes zero, negative, non-finite, and non-numeric-typed values)

- [x] **3.8** Test: a rejected/aborted `fetch` (mock rejects) causes `fetchFxRate` to return `1` and never throw.
  - Traces to: spec "Scenario: fetchFxRate never throws to its callers regardless of response validity"

- [x] **3.9** Test: `fetchJson` called directly — rejects on a non-`ok` response, resolves the parsed JSON body on an `ok` response.
  - Traces to: spec "Requirement: Non-OK HTTP Responses Are Never Treated as Successful Data"

- [x] **3.10** Run `node --test` locally and confirm all cases in 3.2-3.9 pass green.
  - Traces to: proposal Success Criteria ("`node --test` runs green locally")
  - Depends on: 3.1-3.9
  - Mechanical, not manual: this is the primary acceptance mechanism for this change, replacing what would previously have been manual verification.

- [x] **3.11** Manual browser smoke test (full): with Phase 2's gating logic in place, add a manual asset in a foreign currency (e.g. USD) via the asset creation form and trigger a price refresh; confirm the value converts using a real fetched rate rather than silently defaulting to 1:1.
  - Traces to: proposal Success Criteria (manual browser smoke test, second half — conversion correctness); spec "Requirement: FX Rate Cache Only Stores Validated Numeric Rates"
  - Depends on: 1.3, 2.2
  - Manual, proportional: single end-to-end check exercising the real defect path; all edge cases are already covered mechanically in 3.2-3.9, so no further manual matrix is needed here.

## Phase 4 — Config and documentation (independent of Phases 1-3, editable in parallel)

- [x] **4.1** Update `openspec/config.yaml`: set `rules.apply.test_command` and `rules.verify.test_command` to `node --test` (both currently `""`).
  - Traces to: proposal Success Criteria; design Testing Strategy (run command)
  - Depends on: none
  - Owner note: this edit belongs to `sdd-apply`, not `sdd-tasks` — do not perform it while writing this checklist.

- [x] **4.2** Update `openspec/config.yaml`: add a line to the `context:` block documenting the Node >= 22.7 requirement (automatic ESM detection for `.js` files), and revise `testing.note` / `rules.verify.note` so they no longer assert that no automated test suite exists.
  - Traces to: design "Decision: plain `.js`, not `.mjs`" ("Where to document"); design "Tradeoff accepted in its place"
  - Depends on: none
  - Owner note: same as 4.1 — deferred to `sdd-apply`.

## Explicitly Out of Scope (no task exists for these; call out any deviation as a defect)

- **`sw.js`** — untouched. No precache entry added for `fx.js`, no `CACHE_NAME` bump. A reviewer should see zero `sw.js` lines in the diff. (Design "Decision: this change touches NO service-worker file"; tracked separately as design Follow-up A, its own future SDD cycle.)
- **`app.js:1086`** (`txExtra = { fxRate: rate }`) persisting a fallback `1` as if it were a real rate — design Follow-up B, not this change.
- Refactoring `app.js`'s top-level DOM lookups or its overall size; currency-conversion semantics, provider selection, or batching — proposal "Out of Scope".

## Footprint vs. Review Budget

| Component | Lines | Nature |
|---|---|---|
| `app.js:105-128` deletion | -24 | Moved out, not removed logically |
| `fx.js` (moved body + `resetFxCache` + 2.1/2.2 edits) | ~35 added | ~24 are moved lines, ~11 are new logic (`res.ok` check, validation gate, `resetFxCache`) |
| `app.js` import line | +1 | New |
| `fx.test.js` (header + 9 test cases + setup) | ~90-120 | New |
| `openspec/config.yaml` (4.1 + 4.2) | ~4-6 | New, not counted against the 400-line code budget but included here for completeness |

Net new/changed lines excluding the moved 24: roughly **120-150**. Including the moved block (counted once, as a deletion + an addition, per standard diff accounting): roughly **170-200** changed lines total. Both figures are comfortably inside the 400-line review budget stated in the session preflight; this remains a single-PR change as the proposal projected (150-180 estimate, confirmed consistent here).

## Browser Smoke Evidence (orchestrator pass)

Both browser tasks were executed by the orchestrator against the app served over
HTTP, using a `fetch` stub for the provider responses.

**1.4 — module load.** `fx.js` served `200 text/javascript`. The app booted with
0 console errors and 0 warnings, so the new relative import resolves with no
build step.

**3.11 — real-rate conversion, end to end.** One USD-denominated stock asset
(100.00 unit price, quantity 10). Alpha Vantage stubbed to succeed; Frankfurter
stubbed to return HTTP 200 with a malformed body on the first call and a valid
`rates.EUR = 0.9` on the second.

| Observation | Value |
|---|---|
| Frankfurter requests issued | 2 |
| Transaction amount after the malformed response | 1000 |
| Transaction amount after the valid response | 900 |

The second request proves the malformed response was never cached. Before this
change the cached `1` would have satisfied the truthy guard and no second request
would have been made, leaving the amount at 1000 for the rest of the session.
