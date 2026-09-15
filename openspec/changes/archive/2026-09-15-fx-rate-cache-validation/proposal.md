# Proposal: FX Rate Cache Validation

## Intent

`fetchFxRate()` poisons its own session cache. On the success path (`app.js:123`) it writes `_fxCache[key] = data.rates?.[to] || 1;`, using `1` as an absent-value sentinel. `1` is truthy, so the guard at `app.js:120` (`if (_fxCache[key]) return _fxCache[key];`) returns the sentinel for that currency pair for the rest of the session, silently recording foreign-currency prices as EUR at 1:1. Observed at runtime in the previous cycle. The legitimate 1:1 case is already short-circuited at `app.js:118` (`from === to`), so a structural validity check before caching is safe.

The same "treat an invalid response as valid" defect exists upstream: `fetchJson` (`app.js:105-114`) never checks `res.ok`, so an HTTP error response carrying a JSON body flows through the success path into the cache.

Hard constraint: `fetchFxRate` MUST NOT throw. Caller `app.js:222` is inside a per-asset `try/catch`, but caller `app.js:1084` sits in the `formAsset` submit handler (declared `app.js:1054`) with no `try/catch` between them — a throw would create the asset and skip `store.addTransaction(...)`. The fix therefore validates what is **cached**, not what a single call **returns**.

## Scope

### In Scope
- Validate the FX rate is a real usable number before writing it to `_fxCache`; never cache a fallback sentinel.
- Make `fetchJson` reject or signal non-`ok` HTTP responses instead of parsing them as success.
- Extract the FX/fetch logic out of `app.js` into a new importable pure module, consumed by both `app.js` and tests.
- Add the repository's first automated tests using `node:test` with a mocked `fetch` (Node v24.18.0 available; `mock` API verified).

### Out of Scope
- Refactoring `app.js` top-level DOM lookups (`app.js:548-563`) or its 1834-line size.
- Currency-conversion semantics, provider selection, batching.
- Retrofitting tests beyond the extracted module.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `price-refresh-reliability`: add FX cache-integrity requirements — a rate is cached only when it is a validated numeric rate, a fallback is never persisted to the cache, an HTTP non-`ok` response is not treated as success, and `fetchFxRate` never throws to its callers. Same shape as the existing "Truthful Freshness Stamp" requirement (do not let a false signal look like success), applied to `_fxCache` instead of `lastPriceUpdate`.

## Approach

Move `fetchJson`, `_fxCache`, and `fetchFxRate` into a dedicated module with no DOM dependency, then add a validity gate on the cache write and an `res.ok` gate in `fetchJson`. `app.js` imports the module; behaviour at both call sites is unchanged except that a bad rate is no longer sticky. Tests import the module directly in Node and drive it with a mocked `fetch`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app.js:103-128` | Removed | FX/fetch block moves out (~26 lines deleted) |
| `app.js` (imports, callers 222 / 1084) | Modified | Import the new module; call sites unchanged |
| new FX module | New | Extracted logic plus validation gates |
| new test file | New | First `node:test` suite with mocked `fetch` |
| `openspec/specs/price-refresh-reliability/spec.md` | Modified (at archive) | Delta merged from this change |

Footprint estimate: ~26 moved lines + ~20 new logic lines + ~80-120 test lines ≈ 150-180 changed lines. Comfortably inside the 400-line review budget; single PR expected.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Extraction breaks module load in the browser (no bundler) | Med | Design decides `.mjs` vs `package.json` `"type":"module"`; manual browser smoke test |
| `res.ok` rejection reaches the untry-caught submit handler at `app.js:1084` | Med | Never-throws contract is a spec requirement; `fetchFxRate` absorbs the rejection internally |
| Losing the `1` fallback changes conversion output | Low | Fallback return value preserved; only the cache write is gated |

## Rollback Plan

The change is confined to the new module, the `app.js` import/extraction site, and the new test file. Revert the commit on `fix/fx-rate-cache-validation`; no persisted data, storage schema, or user state is touched, so no migration or cache invalidation is needed.

## Dependencies

- Node >= 18 for `node:test` with the `mock` API (v24.18.0 present). No runtime/browser dependency added.

## Deferred to Design

- Exact module boundary and filename; `.mjs` vs adding `package.json` with `"type":"module"` (a repo-convention change).
- What `1` means once validation exists — whether callers can distinguish "no rate available" from a real rate under the never-throws constraint.
- Whether non-`ok` becomes a thrown rejection inside `fetchJson` or a different signal.
- The test surface: which behaviours are tested and how `fetch` is mocked.

## Success Criteria

- [ ] A malformed/absent FX response never poisons `_fxCache`; a later successful call for the same pair returns the real rate.
- [ ] An HTTP error response with a JSON body is not treated as a successful rate.
- [ ] `fetchFxRate` never throws; the `formAsset` submit path still creates the asset AND its transaction.
- [ ] `node --test` runs green locally — the first partly mechanical acceptance criteria in this repo, replacing purely manual verification for this module.
- [ ] Manual browser smoke test: app loads with the extracted module, a refresh with a foreign-currency asset converts correctly.
