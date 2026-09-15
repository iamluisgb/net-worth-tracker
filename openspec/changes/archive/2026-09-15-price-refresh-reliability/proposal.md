# Proposal: Price Refresh Reliability

## Intent

`fetchPrices()` can hang forever and can lie about having refreshed.

- **No fetch timeout.** `app.js:182` (CoinGecko), `app.js:209` (Alpha Vantage) and `app.js:106` (`fetchFxRate`) call `fetch()` with no abort signal. A hanging endpoint means the `await` never settles, so the `try/finally` at `app.js:238` never runs: the refresh button stays `disabled` and the spinner spins until reload.
- **Unconditional freshness stamp.** `store.editSettings({ lastPriceUpdate })` at `app.js:237` runs even when every request failed or when stocks were skipped for a missing Alpha Vantage key (`app.js:202`). That records a refresh that never happened and then suppresses the 7-day catch-up in `scheduleAutoRefresh()` (`app.js:296-300`).
- **Stale doc.** `PHASE4_API_PRICES.md:3` says `Status: Planned — not yet implemented`, but Phase 4 is fully implemented and exceeds the document. The next reader may rebuild existing code.

## Scope

### In Scope
- Abort-based timeout on every outbound request in the price-refresh path (CoinGecko, Alpha Vantage, Frankfurter FX). A timeout counts as a failure, never as an infinite wait.
- Persist `lastPriceUpdate` only when at least one asset was actually updated.
- Correct the status header of `PHASE4_API_PRICES.md` to reflect implemented state.

### Out of Scope
- Retro-documenting Phase 4 into `openspec/specs/` (user declined).
- New feature work on Alpha Vantage, Frankfurter, or the settings UI.
- Introducing a test runner, linter, or build tooling.
- Retry/backoff policy and offline queueing.

## Capabilities

### New Capabilities
- `price-refresh-reliability`: bounded-time behavior and truthful freshness recording for the price-refresh flow. Scoped to these two guarantees only; it does not specify Phase 4 feature behavior.

### Modified Capabilities
- None (`openspec/specs/` is empty).

## Approach

Wrap each `fetch()` in an `AbortController` with a shared timeout helper, keeping the existing per-call `try/catch` failure counting. Gate the `lastPriceUpdate` write on `updated > 0`. Vanilla ES modules, no new dependency.

Deferred to **design**: the timeout value; whether a CoinGecko batch timeout fails all its assets or is resolved per-asset; whether the timeout helper lives beside `fetchFxRate` or is shared.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app.js:106-127` | Modified | `fetchFxRate` timeout |
| `app.js:165-242` | Modified | `fetchPrices` timeouts + conditional stamp |
| `PHASE4_API_PRICES.md:3` | Modified | Status header correction |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Timeout too short aborts slow-but-valid responses | Med | Design picks the value; abort is counted as a normal failure |
| Alpha Vantage 12s pacing loop confused with timeout | Med | Timeout applies per request, not to the `setTimeout` pacing |
| Gating the stamp makes auto-refresh re-fire each load | Low | `scheduleAutoRefresh` already no-ops when `lastPriceUpdate` is unset |

## Rollback Plan

Single-commit revert. All changes are localized to `app.js` and one markdown header; no storage schema, no persisted-data migration.

## Dependencies

- None. `AbortController` is available in all PWA target browsers.

## Verification Strategy

No automated test suite exists (`openspec/config.yaml` `strict_tdd: false`). Verification is manual and reproducible in Chrome DevTools:

- Block `api.coingecko.com` (Network request blocking) → refresh ends, button re-enables, spinner stops, toast reports failures.
- Throttle to offline mid-refresh → same bounded outcome.
- After an all-failed refresh, confirm `lastPriceUpdate` in localStorage is unchanged.
- After a partially successful refresh, confirm it advances.
- Structural readback of the `PHASE4_API_PRICES.md` header.

**Review budget**: estimated ~40-70 changed lines, well inside the 400-line budget. Single PR.

## Success Criteria

- [ ] No request in the refresh path can leave the button disabled or the spinner running indefinitely.
- [ ] `lastPriceUpdate` advances if and only if `updated > 0`.
- [ ] A missing Alpha Vantage key no longer suppresses the 7-day auto-refresh.
- [ ] `PHASE4_API_PRICES.md` no longer claims Phase 4 is unimplemented.
