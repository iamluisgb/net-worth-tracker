# Verification Report: fx-rate-cache-validation

**Change**: fx-rate-cache-validation
**Mode**: Full artifact set (proposal, delta spec, design, tasks) — openspec store
**Verdict**: PASS WITH WARNINGS

## Test Execution (re-run independently)

```
$ node --version
v24.18.0
$ node --test
tests 13
suites 2
pass 13
fail 0
cancelled 0
skipped 0
duration_ms 168.018651
```

Matches the orchestrator's previously reported counts exactly (13/13, 0 fail).

```
$ node --check app.js   -> exit 0, no output
$ node --check fx.js    -> exit 0, no output
```

## Task Completeness

All 22 tasks across Phases 1-4 are checked in `tasks.md` and each checkbox matches observed code/test/config state. No correction made to `tasks.md`.

## Spec Compliance Matrix

### Requirement: FX Rate Cache Only Stores Validated Numeric Rates

| Scenario | Status | Evidence |
|---|---|---|
| A malformed FX response body is not cached | PASS | `fx.test.js:49-60` ("a missing rates[to] returns 1, is not cached, and a later valid call succeeds") |
| A genuine numeric rate is cached and reused | PASS | `fx.test.js:31-38` |
| A legitimate 1:1 rate between distinct currencies is cached like any other rate | PASS | `fx.test.js:40-47` |
| Same-currency requests never hit the network or cache-validation path | PASS | `fx.test.js:24-29` (`fetch` call count asserted `0`) |
| A bad response does not poison later legitimate calls | PASS | same test as row 1 (`fx.test.js:49-60`); second call with valid data returns `0.85`, proving no stickiness |

### Requirement: Non-OK HTTP Responses Are Never Treated as Successful Data

| Scenario | Status | Evidence |
|---|---|---|
| A non-ok response with a JSON error body is not treated as success | PASS | `fx.test.js:62-66` (fetchFxRate) and `fx.test.js:89-92` (fetchJson `rejects` assertion) |
| fetchFxRate never throws to its callers regardless of response validity | PASS at the function level; WARNING at the compound call-site level — see Issues | `fx.test.js:62-85` and the table-driven invalid-rate block (`fx.test.js:68-77`) exhaustively exercise fetchFxRate's own never-throw contract (non-ok, invalid numeric values, rejected fetch — 7 cases, all return `1`). The "calling code path must continue... still creating the asset and its transaction" half of this scenario is NOT covered by an automated test (fx.test.js only exercises fx.js in isolation, no DOM/app.js harness exists per design's declared scope). It is covered by: (a) direct code inspection of app.js's submit handler (see Trace below), and (b) the parent's browser smoke evidence in tasks.md, which exercised only a partial-failure-then-recovery path (malformed → valid), not a total-failure path where fetchFxRate returns the fallback `1` for the entire interaction. |

## Design Decision Conformance

| Decision | Verified | Evidence |
|---|---|---|
| Plain `.js`, not `.mjs`; no `package.json` added | YES | `fx.js`/`fx.test.js` extensions; `git status` shows no `package.json` |
| `fetchJson` rejects on `!res.ok` | YES | `fx.js:8` `if (!res.ok) throw new Error(\`HTTP ${res.status}\`);` |
| Cache gate `Number.isFinite(rate) && rate > 0` | YES | `fx.js:23` |
| Fallback `1` returned but never cached | YES | `fx.js:27` returns `1` without a preceding cache write when the gate fails |
| Same-currency short-circuit before cache read and fetch | YES | `fx.js:17` `if (from === to) return 1;` precedes the cache lookup (`fx.js:19`) and any `fetchJson` call |
| `fetchFxRate` never throws | YES (see WARNING above for the compound call-site claim) | `fx.js:20-30` — the only `throw` reachable from inside `fetchFxRate` is `fetchJson`'s, which is raised inside `fetchFxRate`'s own `try` (`fx.js:20`) and caught by its `catch` (`fx.js:28-30`), which returns `1`. No throw site exists outside that `try`. |

### Never-throws trace through the submit handler (task 4)

`app.js:1028` `formAsset.addEventListener('submit', async (e) => {...})` runs to `app.js:1075` with no `try/catch` wrapping the block. `fetchFxRate` is called at `app.js:1058`, inside `if (currency !== 'EUR' && initialValue > 0)`. Since `fetchFxRate` (per the trace above) always resolves — never rejects — to a number, execution unconditionally reaches `store.addTransaction(...)` at `app.js:1062-1071`. No path added by this change (the new `throw` in `fetchJson`, the new cache-validation branch) is reachable outside `fetchFxRate`'s own `try/catch`, so none of it can escape to abort the handler. Confirmed by static trace; not exercised by an automated total-failure test at this call site (see WARNING).

## Phase 1 Discipline (verbatim-move check)

Diffed the deleted `app.js:105-128` block against `fx.js:1-37`. The only differences are: (1) `export` keywords, (2) the added `resetFxCache` test seam (task 1.2, additive, never called from `app.js`), and (3) the two Phase 2 behavioural edits explicitly tasked (`2.1` the `!res.ok` throw, `2.2` the validated cache-write gate replacing `data.rates?.[to] || 1`). No unrelated change rode along.

## Out-of-Scope File Check

`git status --short` / `git diff --stat` for `sw.js store.js drive.js index.html style.css PHASE4_API_PRICES.md` returns empty — none of these files were touched.

`.gitignore` carries a pre-existing modification (`net-worth-data-*.json`, `tr-extracto-import.json` entries) that predates this session's diff scope; it is unrelated to fx-rate-cache-validation and was not touched by this change.

## Footprint vs. 400-Line Review Budget

| File | Diff |
|---|---|
| `app.js` | +1 / -27 |
| `openspec/config.yaml` | +13 / -9 |
| `fx.js` (new) | +37 |
| `fx.test.js` (new) | +99 |
| **Total authored additions+deletions** | **186** |

186 lines, well inside the 400-line budget and consistent with tasks.md's own 170-200 estimate.

## openspec/config.yaml Accuracy (task 8)

`context:` and `testing.note` and `rules.verify.note` were all correctly updated — none of them claims "no automated test suite" anymore; they correctly describe `node:test` / `node --test` scoped to `fx.js`.

**WARNING**: `rules.proposal` still contains the line `- Note that there is no automated test suite; manual verification steps are required`. This is now stale — an automated suite exists (scoped to `fx.js`). It is a standing rule applied to all future proposals in this project, not a one-time state description, so it was not in scope for this change's own file edits (task 4.2 only named `context:`/`testing.note`/`rules.verify.note`), but it is now factually incorrect and should be revised or scoped ("no automated test suite outside fx.js") in a follow-up.

## Known, Accepted Out-of-Scope Items (not defects)

- `sw.js` never installs in production (root-absolute `PRECACHE_URLS` vs. GitHub Pages subpath) — Design Follow-up A, its own cycle. Untouched by this change, as designed.
- `app.js:1086` (`txExtra = { fxRate: rate }`) still persists a fallback `1` as a real `fxRate` when no rate is available — Design Follow-up B, not this change's scope.

## Issues

**CRITICAL**: None.

**WARNING**:
1. No automated or browser-verified test covers the total-failure path at the `formAsset` submit handler (`app.js:1058`) — i.e., every FX call failing/timing out for the entire interaction, not just a malformed-then-valid recovery. The never-throws contract is exhaustively unit-tested at the `fx.js` function boundary and confirmed by static trace at the call site, but the specific "asset AND transaction still get created" compound claim rests on code reasoning plus a browser smoke test that exercised only the recovery case, not the always-fails case.
2. `openspec/config.yaml`'s `rules.proposal` list still asserts "there is no automated test suite," which is no longer accurate now that `fx.test.js` exists (scoped to `fx.js`).

**SUGGESTION**: None beyond the two WARNINGs above.

## Onboarding Note: How Verification Changes With a Test Suite

The previous cycle (`price-refresh-reliability`) had `test_command: ""` — verification relied entirely on manual DevTools scenarios (blocking requests, checking timers/spinners) that this agent could not re-run itself; it had to trust the orchestrator's manual walkthrough as the evidence of record for every spec scenario.

This cycle is different in kind, not just degree: `node --test` is a real, independently re-runnable command. This agent ran it itself and got the same 13/13 result the orchestrator reported — that is now first-class runtime evidence per the skill's rule ("a spec scenario is compliant only when a covering test passed at runtime"), not a trust relationship. Six of the seven spec scenarios in this delta are covered exactly this way. Only the DOM-coupled, submit-handler-level compound behavior (still creating the asset and transaction after every possible FX failure mode) remains manual/structural, because the test suite deliberately stops at `fx.js`'s boundary (no DOM harness was introduced, matching the design's stated scope) — that residual gap is exactly what is flagged as WARNING 1 above, not a suite-wide limitation.

## Addendum: Both WARNINGs Closed (orchestrator pass)

### WARNING 1 — call-site half of the never-throws requirement: now executed, not traced

The verify pass could only reason statically about a total FX failure reaching the
`formAsset` submit handler. That path has now been exercised in a real browser.

Setup: the asset-creation form filled with a USD-denominated asset (initial value
250, quantity 5) while `fetch` to Frankfurter rejects outright with a `TypeError`,
simulating a hard network failure rather than a malformed response.

| Observation | Value |
|---|---|
| Frankfurter attempts | 1 (rejected) |
| Asset created | true |
| Transaction created | **true** |
| Transaction amount | 250 |
| Recorded `fxRate` | 1 |

The handler reached `store.addTransaction(...)` despite the total FX failure, so
the never-throws contract holds at the call site and not only at the function
boundary. Had the rejection escaped `fetchFxRate`, the asset would exist with no
initial transaction and no visible error.

This run also produced the first runtime evidence for Follow-up B: the persisted
transaction carries `fxRate: 1`, a fallback recorded as though it were a real
market rate. That remains out of scope for this change and is now backed by an
observation rather than by reasoning alone.

### WARNING 2 — stale config rule: corrected

`openspec/config.yaml` `rules.proposal` still instructed future proposals to
"Note that there is no automated test suite; manual verification steps are
required". This change made that false. It was the same class of assertion task
4.2 was meant to correct and it sits in a file this change already edits, so it
was corrected rather than deferred:

    Note which acceptance criteria the `node --test` suite covers; anything
    outside its scope still needs manual verification steps

Both WARNINGs are resolved. No CRITICAL findings were raised at any point.
