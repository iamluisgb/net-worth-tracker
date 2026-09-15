# Verification Report: price-refresh-reliability

**Change**: price-refresh-reliability
**Mode**: full artifacts (proposal + spec + design + tasks), no automated test runner (per `openspec/config.yaml`)
**Verdict**: PASS WITH WARNINGS

## Completeness Table

| Section | Status |
|---|---|
| 1. Implementation (1.1–1.5) | All 5 tasks marked `[x]`; matches diff |
| 2. Documentation (2.1) | Marked `[x]`; matches diff |
| 3. Manual Verification (3.1–3.10) | 4/10 ticked on genuine evidence (3.1, 3.4, 3.7, 3.10); 6 remain unticked, unverified |

No unchecked task exists in sections 1–2, so full implementation verification is not blocked by the "unchecked task" gate.

## Build/Test Evidence

- No test runner, linter, type checker, or formatter is configured (`openspec/config.yaml`). Verification relies on static diff inspection plus manual/browser evidence, per that config's explicit allowance.
- `node --check app.js` → exit 0 (syntax valid). Re-verified independently in this phase.
- `gentle-ai review assess` → risk `medium`, 3 changed paths, 32 changed lines. The only cited reason is `executable_change` on `.gitignore`, a pre-existing unrelated modification (confirmed below) — not attributable to this change's diff.

## Diff Footprint vs 400-line Budget

`git diff --stat` (working tree vs HEAD):
- `.gitignore`: +4/-0 — **pre-existing, unrelated modification** (adds `net-worth-data-*.json` / `tr-extracto-import.json` ignore rules). Not in this change's Affected Areas table and not traceable to any task. Excluded from this change's authored footprint.
- `PHASE4_API_PRICES.md`: +1/-1 (task 2.1)
- `app.js`: +18/-8 (tasks 1.1–1.5)

In-scope authored footprint: **~28 changed lines**, close to proposal's own ~26-line estimate, well inside the 400-line budget. Confirms `Footprint Check` table in tasks.md.

## Spec Compliance Matrix

5 requirements, 11 scenarios counted from `specs/price-refresh-reliability/spec.md`.

| Requirement | Scenario | Evidence | Status |
|---|---|---|---|
| Bounded-Time Outbound Requests | CoinGecko never responds | Playwright run: hanging CoinGecko, `abortFired: true`, `elapsedMs: 10834` (~10s bound + overhead), `buttonReleased: true`, `spinnerStopped: true` | **PASS** (runtime-verified) |
| Bounded-Time Outbound Requests | Alpha Vantage never responds | No hang/abort scenario was run against Alpha Vantage — only fast stubbed responses (see below) | **UNTESTED** — code path is structurally identical (`fetchJson(url, 15000)`, same helper as CoinGecko), but per the hard rule "a scenario is compliant only when a covering test passed at runtime," this is not proven, only structurally plausible |
| Bounded-Time Outbound Requests | Frankfurter never responds | Not run | **UNTESTED** |
| Bounded-Time Outbound Requests | Pacing wait not affected by timeout | Playwright run: 2 AV assets, `gapBetweenAvRequestsMs: 12220` (~12s, matches the `12000` pacing constant), `pacingPreserved: true` | **PASS** (runtime-verified) |
| Timeout Treated as Normal Failure | Timeout increments failure count | Not directly run (no mixed timeout+success scenario) | **UNTESTED** — code inspection: aborted `fetchJson` rejects into the existing `catch`, which increments `failed` unchanged from before; consistent with design but not runtime-proven for a timeout specifically |
| Refresh Always Releases UI Lock | Total failure still releases lock | CoinGecko-hang run showed `buttonReleased: true`, `spinnerStopped: true`, but that run is single-provider (CoinGecko only); a true multi-provider total-failure run was not executed | **PARTIAL** — covered for the single-provider case, not the "every provider unreachable" case |
| Truthful Freshness Stamp | Total failure does not advance stamp | CoinGecko-hang run: `stampAdvanced: false` — but again single-provider, not "every request fails" as the scenario specifies | **PARTIAL** |
| Truthful Freshness Stamp | Partial success advances stamp | Not run (the AV 2-asset run had both succeed — full success, not partial) | **UNTESTED** |
| Truthful Freshness Stamp | Zero configured tickers does not advance stamp | Not run | **UNTESTED** |
| Truthful Freshness Stamp | Missing AV key does not falsely advance stamp | Playwright run: 1 stock asset, no AV key, `stampAdvanced: false`, `daysSinceStamp: 14.44` (stamp untouched, still >7 days old) | **PASS** (runtime-verified) |
| Auto-Refresh Suppression Requires Real Refresh | Repeated total failures keep eligibility | The missing-key run's `daysSinceStamp: 14.44` and `stampAdvanced: false` demonstrate the stamp stayed old and auto-refresh remains eligible, but that run is the "missing key" scenario, not the "every provider unreachable" scenario this requirement specifies | **PARTIAL** — same underlying mechanism proven, different triggering scenario |

Summary: 3 scenarios fully runtime-verified, 3 partially covered by adjacent evidence, 5 untested by runtime evidence. All untested/partial scenarios are gated on code paths that are structurally symmetric to the verified ones (same `fetchJson` helper, same `updated > 0` gate) — source inspection gives high confidence but does not meet the "covering test passed at runtime" bar this project's own config explicitly defers to manual verification for. This is a **CRITICAL** gap only in the strict sense of "not runtime-proven"; the project's own `verify` config accepts manual verification as the completion path, and tasks.md section 3 already tracks exactly this as outstanding, unblocking work.

## Design Coherence Table

| Design decision | Verified against diff | Status |
|---|---|---|
| `AbortController` + `setTimeout`, NOT `AbortSignal.timeout()` | `app.js`: `const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);` | PASS |
| Timer cleared in `finally` after `res.json()` resolves, not after `fetch()` settles | `finally { clearTimeout(timer); }` sits after `return await res.json();` inside `try` | PASS |
| Per-endpoint timeouts: Frankfurter 8000ms, CoinGecko 10000ms, Alpha Vantage 15000ms | Confirmed at each of the three call sites in diff | PASS |
| CoinGecko all-or-nothing accounting preserved | Surrounding `try { ... } catch { failed += cryptoAssets.length; }` left untouched; only the two fetch/parse lines were replaced | PASS |
| 12s Alpha Vantage pacing `await` NOT wrapped by the timeout | `if (i > 0) await new Promise(r => setTimeout(r, 12000));` line is unchanged and sits outside/before the `fetchJson` call, not inside its `AbortController` scope | PASS — this is the single most consequential constraint in the design and it holds |
| Outer `try` (`app.js:176`) not wrapped by a single timeout | No change to the outer `try/finally` structure; `fetchJson` timeouts are local to each call site | PASS |
| `fetchFxRate` failure path returns `1` without writing `_fxCache[key]` | `catch { return 1; }` replaces `catch { _fxCache[key] = 1; }` | PASS |
| Stamp gated on `updated > 0` | `if (updated > 0) { store.editSettings(...) }` replaces unconditional call | PASS |
| Local helper in `app.js`, no new module | `fetchJson` declared inline above `_fxCache`, no new file/import | PASS |
| `PHASE4_API_PRICES.md` status header correction | `Planned — not yet implemented` → `Implemented` | PASS |

All ten design decisions carried through verbatim. No deviation found.

## Correctness / Out-of-Scope Check

- No file outside `app.js`, `PHASE4_API_PRICES.md`, and the pre-existing unrelated `.gitignore` change was touched.
- `PHASE4_API_PRICES.md` change is header-only — no retro-documentation of Phase 4 features (per proposal's explicit out-of-scope).
- No new dependency, no build step introduced.
- No retry/backoff logic added (explicitly out of scope).

## Residual Gap: `fetchFxRate` success-path caching (assessed, not an apply defect)

`fetchFxRate`'s success path still runs `_fxCache[key] = data.rates?.[to] || 1;` unconditionally. A `200` response with an unexpected/malformed body (e.g. missing `rates[to]`) is indistinguishable from a real `1:1` rate and gets cached for the session — the same silent USD-as-EUR outcome the failure path used to produce.

**Assessment: this is out-of-contract-scope, not an apply defect.**
- design.md line 22 explicitly limits the fix to the failure path: *"the failure path MUST return `1` **without writing it to `_fxCache`**. The `1` fallback itself stays (changing conversion semantics is out of scope..."*
- tasks.md task 1.2 explicitly constrains: *"the success path ... keeps writing to `_fxCache` as before — only the failure path stops caching."*
- proposal.md's Out of Scope section excludes "New feature work on Alpha Vantage, Frankfurter, or the settings UI" and "Retry/backoff policy."
- The apply diff matches these constraints exactly (success-path line unchanged, only the `catch` block changed).

Apply conformed correctly to its contract. This is flagged below as a **SUGGESTION** for a follow-up change (design.md's own "Open Questions" section already names it as a deferred follow-up: *"replacing the FX `rate = 1` fallback with an explicit per-asset failure"*), not a defect of this change.

## Issues

### CRITICAL
None. No unchecked implementation/documentation task, no design deviation, no out-of-scope file mutation, no budget overrun.

### WARNING
1. 5 of 11 spec scenarios (Alpha Vantage timeout, Frankfurter timeout, timeout-as-failure-count, partial-success stamp advance, zero-tickers stamp) have no runtime evidence at all — only structural/code-path plausibility via the shared `fetchJson` helper and the shared `updated` counter. tasks.md section 3 tracks this already (now reflected as unticked). Recommend running the remaining DevTools procedures (3.2, 3.3, 3.5, 3.6, 3.8, 3.9) before treating this change as fully proven, even though nothing found so far contradicts the design.
2. 3 scenarios ("total failure releases lock", "total failure does not advance stamp", "repeated total failures keep auto-refresh eligibility") were only demonstrated via single-provider failure (CoinGecko-only, or missing-AV-key), not the "every configured provider unreachable" case the scenarios literally specify. The underlying mechanism (gate on `updated > 0`) is provider-agnostic, so this is a lower-severity gap than the fully untested scenarios above, but it is still not the exact scenario.

### SUGGESTION
1. `fetchFxRate`'s success path still caches `data.rates?.[to] || 1` unconditionally; a `200` with a malformed body is cached as a silent `1:1` rate for the rest of the session. Confirmed out-of-scope for this change per design.md and tasks.md 1.2, and already named as a design.md "Open Questions" follow-up. Worth a small follow-up change (e.g. only cache when `data.rates?.[to]` is a genuine number) since timeouts making failures more frequent also makes this path more frequently hit.
2. Consider running the remaining 6 unticked section-3 scenarios in a follow-up manual QA pass, or wiring a lightweight assertion-only smoke script, before this project accumulates more untested reliability guarantees.

## Task Checkbox Reconciliation

tasks.md section 3 headers previously had no `[x]`/`[ ]` markers. This phase added markers reflecting only genuinely evidenced coverage:
- Ticked `[x]`: 3.1 (CoinGecko block), 3.4 (pacing interval intact), 3.7 (missing AV key), 3.10 (doc readback — verified directly by this phase).
- Left `[ ]`: 3.2, 3.3, 3.5, 3.6, 3.8, 3.9 — no covering runtime evidence was supplied for these; do not treat as complete.

## What "verify" checks vs. code review

`sdd-verify` is a conformance gate, not a taste/quality review: it checks whether the delivered code matches what the spec, design, and tasks already committed to — every design decision followed verbatim, every task's diff present, no scope creep into unrelated files, and each spec scenario backed by runtime evidence where evidence exists. It does not second-guess architectural choices (those were settled in `sdd-design`) and does not look for stylistic improvements — that is ordinary code review's job. Where evidence is missing, verify reports the gap explicitly rather than either inventing a pass or blocking on artifacts the project's own config says are optional (manual verification here, since there is no test runner).

## Addendum: Runtime Evidence for Section 3 (orchestrator pass)

All ten manual-verification scenarios were executed in a real browser (Playwright
against the app served over HTTP). Stalled endpoints were simulated with a `fetch`
stub that honours `AbortSignal`, matching how a real stalled connection behaves.
Measured results:

| # | Scenario | Measured result |
|---|----------|-----------------|
| 3.1 | CoinGecko stalled | abort fired, released after 10834 ms, stamp unchanged |
| 3.2 | Alpha Vantage stalled | abort fired, released after 15019 ms, stamp unchanged |
| 3.3 | Frankfurter stalled | abort fired 8172 ms after the FX request, no hang |
| 3.4 | Pacing interval, 2 stock assets | 2 requests, 12220 ms apart (>= 12000 ms) |
| 3.5 | Total failure | stamp unchanged |
| 3.6 | Success | stamp advanced |
| 3.7 | Missing Alpha Vantage key | stamp unchanged, 14.44 d since last real refresh |
| 3.8 | Two consecutive total failures | stamp unchanged across both runs, 5.45 d preserved |
| 3.9 | Zero configured tickers | 0 price API calls, stamp unchanged, completed in 1 ms |
| 3.10 | Documentation readback | status header reads "Implemented" |

Scenario 3.4 is the decisive one: a 12220 ms gap proves the request timeout did not
collapse the Alpha Vantage rate-limit pacing wait.

### Incidental observation (follow-up evidence, not a defect of this change)

During 3.3 the Alpha Vantage response succeeded while Frankfurter stalled. The asset
was still updated, using the `1` fallback rate — so a USD price was recorded as EUR
at 1:1. This is the documented out-of-scope behaviour: design.md keeps the `1`
fallback and scopes only its caching. It is now observed at runtime and strengthens
the case for the deferred `fetchFxRate` follow-up change.
