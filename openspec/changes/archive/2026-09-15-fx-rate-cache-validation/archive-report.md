# Archive Report: fx-rate-cache-validation

**Change**: `fx-rate-cache-validation`
**Capability**: `price-refresh-reliability` (MODIFIED — delta merged)
**Archived**: 2026-09-15
**Commit**: cb8bc9c
**Branch**: fix/fx-rate-cache-validation

## Executive Summary

`fetchFxRate` cached `data.rates?.[to] || 1` on its success path. Because `1` is
truthy, the guard `if (_fxCache[key]) return _fxCache[key]` then served `1` for
that currency pair for the rest of the session, valuing foreign-currency assets
at 1:1 EUR with nothing shown to the user. An HTTP 200 carrying an unexpected
body was enough to trigger it.

Only a validated rate is cached now, gated on `Number.isFinite(rate) && rate > 0`.
The fallback `1` is still returned, preserving the never-throws contract.
`fetchJson` additionally rejects on a non-ok response, which previously flowed
through the success path whenever the error body happened to be valid JSON.

The logic moved into `fx.js`, a DOM-free module. That extraction is what made the
change testable at all: `app.js` cannot be imported in Node because of its
top-level `document` lookups at app.js:548-563. This change therefore also
introduces the repository's first automated tests.

## Specification

Delta type: **ADDED**, two requirements merged into the existing capability.

- FX Rate Cache Only Stores Validated Numeric Rates (5 scenarios)
- Non-OK HTTP Responses Are Never Treated as Successful Data (2 scenarios)

`openspec/specs/price-refresh-reliability/spec.md` now holds seven requirements.
The five from `price-refresh-reliability` were preserved byte-for-byte; verified
by diffing the merged file's first 105 lines against the previously archived
spec. No `## ADDED Requirements` marker survives in the merged result.

The distinction the spec insists on, and the heart of the change: an absent or
malformed rate is invalid, but the numeric value `1` is not. A genuine 1:1 parity
between two distinct currencies MUST be cached like any other rate.

## Implementation

| File | Change |
|---|---|
| `fx.js` | New. `fetchJson`, private `_fxCache`, `fetchFxRate`, `resetFxCache` test seam. |
| `fx.test.js` | New. 13 `node:test` cases with a mocked `fetch`. |
| `app.js` | Imports from `./fx.js`; the former inline block at app.js:105-128 deleted. |
| `openspec/config.yaml` | `test_command` set to `node --test`; stale "no test suite" claims corrected; Node >= 22.7 documented. |

Not touched, deliberately: `sw.js`, `store.js`, `drive.js`, `index.html`,
`style.css`, `PHASE4_API_PRICES.md`.

Footprint: 186 changed lines against a 400-line review budget.

Design decisions carried through verbatim: plain `.js` rather than `.mjs` (Node
has detected module syntax in `.js` by default since v22.7, verified empirically
on v24.18.0), no `package.json` added per `config.yaml`'s convention, and the
extraction landed as its own phase before any behavioural edit so a reviewer can
tell moved code from rewritten code.

## Verification

Outcome: **PASS WITH WARNINGS** — 0 CRITICAL, 2 WARNING, 0 SUGGESTION.
Both warnings were closed before archive; see the addendum in `verify-report.md`.

Mechanical:

- `node --test` — 13 tests, 13 pass, 0 fail. Re-run independently three times.
- `node --check app.js`, `node --check fx.js` — clean.

Runtime, in a browser against the served app:

| Check | Result |
|---|---|
| Module load after extraction | `fx.js` 200 `text/javascript`; 0 console errors, 0 warnings |
| Malformed FX 200 is not cached | 2 Frankfurter requests; amount 1000 -> 900 once a real rate arrived |
| Total FX failure at the submit handler | asset AND transaction both created; no silent data loss |

The third check closes the never-throws requirement at the call site rather than
only at the function boundary. `app.js`'s `formAsset` submit handler has no
try/catch around its `fetchFxRate` call, so a throw there would have created an
asset with no initial transaction and no visible error.

## Task Completion Status

22 of 22 tasks complete, each with cited evidence.

## Archive Contents

`proposal.md`, `design.md` (revision 3), `specs/price-refresh-reliability/spec.md`
(the delta), `tasks.md`, `verify-report.md`, this report.

## Carried-Forward Follow-ups

### A — Service worker never installs in production. UNFIXED. Highest priority.

`PRECACHE_URLS` at sw.js:2-10 uses site-root-absolute paths (`/`, `/index.html`,
`/app.js`, ...), but the app is deployed to GitHub Pages at the subpath
http://luisgonzalezbernal.com/net-worth-tracker/.

Measured:

    http://luisgonzalezbernal.com/app.js                   -> 301 -> 404
    http://luisgonzalezbernal.com/net-worth-tracker/app.js -> 200 application/javascript

`cache.addAll` rejects if any request fails. That rejection propagates through
`e.waitUntil()` in the install handler (sw.js:12-17), so install fails and the
worker never activates. Registration itself is correct — `register('./sw.js')` is
relative and scopes properly.

Consequence: the PWA has no offline support, no precache, no active worker.

Fix direction: relative precache paths. The offline fallback
`caches.match('/index.html')` at sw.js:49 carries the same bug. Needs its own SDD
cycle, because it makes the app offline-capable for the first time rather than
restoring something that worked.

Downstream of A, unreachable until installation works: `drive.js` and now `fx.js`
are eagerly imported at the top of `app.js` but absent from `PRECACHE_URLS`.

### B — A fallback rate is persisted as though it were real. Needs a product decision.

`app.js` records `txExtra = { ..., fxRate: rate }` when creating a
foreign-currency asset. When no rate is available, the fallback `1` is written
there as if it were a market rate, and that record is permanent.

Now backed by runtime evidence: during verification, a total FX failure produced
a stored transaction carrying `fxRate: 1`.

This change removes the session-wide cache poisoning but not this one-shot case.
Fixing it requires deciding what the submit UI should do when no rate exists, so
it is a product decision, not only a code change.

## SDD Cycle Closure

explore -> propose -> spec + design (parallel, design revised twice) -> tasks ->
apply -> verify -> archive. Closed.

Two design revisions were triggered by premises that turned out to be false: that
`.mjs` was required, and that `sw.js`'s precache list was a pattern worth
following. Both were settled by running a command rather than by reasoning. The
service-worker defect in Follow-up A surfaced from the second of those.
