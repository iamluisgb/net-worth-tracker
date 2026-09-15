# Price Refresh Reliability Specification

## Purpose

Guarantee two observable properties of the price-refresh flow (`fetchPrices()` and its dependency `fetchFxRate()`): every refresh completes in bounded time, and the recorded `lastPriceUpdate` timestamp is only ever advanced when it is true. This spec does not define or alter Phase 4 pricing feature behavior (which providers are called, batching, conversion logic) — only these two reliability guarantees.

## Requirements

### Requirement: Bounded-Time Outbound Requests

The system MUST apply a request-level timeout to every outbound HTTP request issued in the price-refresh flow, covering CoinGecko, Alpha Vantage, and Frankfurter FX (`fetchFxRate`). A request that does not receive a response within the timeout MUST be aborted rather than left pending indefinitely.

The Alpha Vantage rate-limit pacing wait (the deliberate delay between requests to respect the provider's 5-requests-per-minute limit) is not an outbound HTTP request and MUST NOT be bounded by the request timeout. The timeout applies only to the `fetch()` call itself.

#### Scenario: CoinGecko endpoint never responds

- GIVEN a refresh is triggered with at least one crypto asset configured
- WHEN the CoinGecko request is blocked (e.g. via DevTools request blocking) so it never responds
- THEN the request MUST abort within the bounded timeout
- AND the refresh MUST complete, re-enabling the refresh button and stopping the spinner

#### Scenario: Alpha Vantage endpoint never responds

- GIVEN a refresh is triggered with a stock asset configured and a valid API key
- WHEN the Alpha Vantage request never responds (simulated via DevTools offline/blocking)
- THEN the request MUST abort within the bounded timeout
- AND the refresh MUST complete, re-enabling the refresh button and stopping the spinner

#### Scenario: FX rate endpoint never responds

- GIVEN a refresh needs a currency conversion via Frankfurter
- WHEN the Frankfurter request never responds
- THEN the request MUST abort within the bounded timeout
- AND the refresh MUST complete without hanging

#### Scenario: Rate-limit pacing wait is not affected by the request timeout

- GIVEN multiple stock tickers are configured, requiring the Alpha Vantage pacing wait between requests
- WHEN a pacing wait between two Alpha Vantage requests is in progress
- THEN the request timeout MUST NOT abort the pacing wait
- AND only the HTTP request that follows the wait is subject to the timeout

### Requirement: Timeout Is Treated as a Normal Failure

A timed-out request MUST be counted identically to any other failed request in the refresh flow: the affected ticker/asset is skipped and counted as a failure, not silently ignored and not treated as success.

#### Scenario: Timeout increments the failure count

- GIVEN a refresh with one crypto and one stock asset
- WHEN the crypto request times out and the stock request succeeds
- THEN the refresh outcome MUST report one failure and one success
- AND the completion toast MUST reflect the failure

### Requirement: Refresh Always Releases the UI Lock

The refresh button and spinner MUST return to their idle state once every outbound request in the flow has either succeeded, failed, or timed out — independent of overall outcome.

#### Scenario: Total failure still releases the UI lock

- GIVEN every configured provider is unreachable (blocked or offline)
- WHEN the refresh runs to completion
- THEN the refresh button MUST be re-enabled and the spinner MUST stop
- AND a toast MUST report that the refresh failed

### Requirement: Truthful Freshness Stamp

The system MUST persist `lastPriceUpdate` if and only if at least one asset price was actually updated during that refresh (`updated > 0`). It MUST NOT persist `lastPriceUpdate` when zero assets were updated, regardless of the reason (all requests failed, all requests timed out, or no tickers were configured to refresh).

#### Scenario: Total failure does not advance the stamp

- GIVEN a known `lastPriceUpdate` value in localStorage
- WHEN a refresh runs and every request fails or times out
- THEN `lastPriceUpdate` in localStorage MUST remain unchanged

#### Scenario: Partial success advances the stamp

- GIVEN a known `lastPriceUpdate` value in localStorage
- WHEN a refresh runs and at least one asset updates successfully while others fail
- THEN `lastPriceUpdate` in localStorage MUST advance to the new refresh time

#### Scenario: Zero configured tickers does not advance the stamp

- GIVEN no crypto or stock tickers are configured for refresh
- WHEN a refresh is triggered
- THEN `updated` MUST be zero
- AND `lastPriceUpdate` in localStorage MUST remain unchanged

#### Scenario: Missing Alpha Vantage key does not falsely advance the stamp

- GIVEN only stock assets are configured and no Alpha Vantage API key is set
- WHEN a refresh runs and all stock assets are skipped for the missing key
- THEN `updated` MUST be zero for those assets
- AND `lastPriceUpdate` in localStorage MUST NOT advance solely because of the skipped stock assets

### Requirement: Auto-Refresh Suppression Requires a Real Refresh

`scheduleAutoRefresh()`'s 7-day catch-up check MUST only be suppressed by a `lastPriceUpdate` that reflects an actual successful update, never by a stamp written after total failure or after all assets were skipped.

#### Scenario: Repeated total failures do not push out auto-refresh eligibility

- GIVEN `lastPriceUpdate` is more than 7 days old
- WHEN a refresh is triggered and fails entirely (no asset updated)
- THEN `lastPriceUpdate` MUST remain unchanged
- AND the app MUST still be eligible for the 7-day auto-refresh catch-up on next load

## Out of Scope for This Spec

- The exact timeout duration (design decision).
- Whether a CoinGecko batch timeout fails all its assets or is resolved per-asset (design decision).
- Where the shared timeout helper lives in the codebase (design decision).
- Retry/backoff policy, offline queueing, and any Phase 4 feature behavior (provider selection, batching, currency conversion logic).
