# Tasks: Price Refresh Reliability

Estimated footprint: ~40-70 changed lines (per proposal), well inside the 400-line review budget. Single PR, sequential (no parallelizable work — all edits touch the same file/region or depend on the shared helper existing first).

## 1. Implementation

### 1.1 Add the shared `fetchJson` timeout helper [x]
- **File**: `app.js`, insert above `const _fxCache = {};` (currently `app.js:105`)
- **Action**: Add
  ```js
  const fetchJson = async (url, timeoutMs) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
          const res = await fetch(url, { signal: ctrl.signal });
          return await res.json();
      } finally {
          clearTimeout(timer);
      }
  };
  ```
- **Traces to**: design.md "Decision: Local helper in `app.js`, not a new module"; design.md "Decision: The timer covers the request AND the body read"
- **Constraint**: `AbortController` + `setTimeout`, NOT `AbortSignal.timeout()` (design.md browser-baseline note). Timer clears in `finally` after `res.json()` resolves, not after `fetch()` settles.
- **Depends on**: none (must land first — 1.2, 1.3, 1.4 call this helper)
- **Parallelizable**: no (prerequisite for 1.2-1.4)

### 1.2 Route Frankfurter FX call through `fetchJson` and stop poisoning the cache on failure [x]
- **File**: `app.js:106-118` (`fetchFxRate`)
- **Action**: Replace the body of the `try`/`catch`:
  - `try`: `const data = await fetchJson(\`https://api.frankfurter.app/latest?from=${from}&to=${to}\`, 8000); _fxCache[key] = data.rates?.[to] || 1;`
  - `catch`: `return 1;` — do NOT write to `_fxCache[key]` on failure (removes `_fxCache[key] = 1;` at current `app.js:115`)
- **Traces to**: spec.md "Bounded-Time Outbound Requests" (FX rate endpoint never responds); design.md "Decision: Timeout values" (Frankfurter 8s); user context "fetchFxRate must return 1 on failure WITHOUT caching it"
- **Constraint**: the success path (`data.rates?.[to] || 1`) keeps writing to `_fxCache` as before — only the failure path stops caching. Function still returns `1` on failure (fallback value unchanged, only its caching behavior changes).
- **Call site**: `app.js:111`
- **Depends on**: 1.1
- **Parallelizable**: no (same file region as 1.3/1.4, apply sequentially to avoid conflicting diffs)

### 1.3 Route CoinGecko batch call through `fetchJson` [x]
- **File**: `app.js:182-183` (inside `fetchPrices`, crypto branch)
- **Action**: Replace
  ```js
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur`);
  const data = await res.json();
  ```
  with
  ```js
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur`, 10000);
  ```
- **Traces to**: spec.md "Bounded-Time Outbound Requests" (CoinGecko endpoint never responds); design.md "Decision: Timeout values" (CoinGecko 10s); design.md "Decision: A CoinGecko batch timeout keeps all-or-nothing semantics"
- **Constraint**: leave the surrounding `try { ... } catch { failed += cryptoAssets.length; }` (`app.js:181`, `app.js:193-195`) unchanged — an abort rejects into this existing catch and preserves all-or-nothing accounting. Do NOT add per-asset retry or per-asset catch.
- **Call site**: `app.js:182`
- **Depends on**: 1.1
- **Parallelizable**: no (see 1.2 note)

### 1.4 Route Alpha Vantage call through `fetchJson` without touching the pacing loop [x]
- **File**: `app.js:209-210` (inside `fetchPrices`, stock loop)
- **Action**: Replace
  ```js
  const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(asset.ticker)}&apikey=${avKey}`);
  const data = await res.json();
  ```
  with
  ```js
  const data = await fetchJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(asset.ticker)}&apikey=${avKey}`, 15000);
  ```
- **Traces to**: spec.md "Bounded-Time Outbound Requests" (Alpha Vantage endpoint never responds; rate-limit pacing wait not affected); design.md "Decision: Timeout values" (Alpha Vantage 15s); design.md "CRITICAL — do not bound the pacing wait"
- **CRITICAL CONSTRAINT — do not violate**: `app.js:206` (`await new Promise(r => setTimeout(r, 12000))`) is DELIBERATE rate-limit pacing for Alpha Vantage's 5-req/min free tier, NOT a hang.
  - The timeout MUST bound the `fetch()` call only (inside `fetchJson`).
  - It MUST NOT wrap the `for` loop (`app.js:205-223`).
  - It MUST NOT wrap the pacing `await` (`app.js:206`).
  - It MUST NOT wrap the outer `try` (`app.js:176`).
  - Wrapping the loop or the pacing await collapses the 12s interval between requests and causes 429s from Alpha Vantage.
- **Call site**: `app.js:209`
- **Depends on**: 1.1
- **Parallelizable**: no (see 1.2 note)

### 1.5 Gate the freshness stamp on `updated > 0` [x]
- **File**: `app.js:237`
- **Action**: Replace
  ```js
  store.editSettings({ lastPriceUpdate: new Date().toISOString() });
  ```
  with
  ```js
  if (updated > 0) {
      store.editSettings({ lastPriceUpdate: new Date().toISOString() });
  }
  ```
- **Traces to**: spec.md "Truthful Freshness Stamp" (all four scenarios: total failure, partial success, zero configured tickers, missing Alpha Vantage key); spec.md "Auto-Refresh Suppression Requires a Real Refresh"; design.md "Freshness-stamp gating" table
- **Constraint**: `updated` is already incremented at the correct points (`app.js:188` crypto, `app.js:216` stock) — no new counter, no new state. Do not touch the `try/finally` structure (`app.js:176`/`app.js:238-241`) that re-enables the button and stops the spinner; this gate lives inside the `try` block, before `finally`.
- **Depends on**: 1.1-1.4 (logically independent of them, but sits in the same function — apply after to avoid re-diffing the same block twice)
- **Parallelizable**: no

## 2. Documentation

### 2.1 Correct the stale status header in `PHASE4_API_PRICES.md` [x]
- **File**: `PHASE4_API_PRICES.md:3`
- **Action**: Change `Status: Planned — not yet implemented` to reflect that Phase 4 is fully implemented (e.g. `Status: Implemented`).
- **Traces to**: proposal.md "Stale doc" intent; proposal.md Affected Areas table (`PHASE4_API_PRICES.md:3`, Modified, "Status header correction")
- **Constraint**: header correction only — do NOT retro-document Phase 4 features, providers, or behavior into this file or into `openspec/specs/` (explicitly out of scope per proposal.md).
- **Depends on**: none (independent of 1.x, can be done in any order, but grouped last since it's non-behavioral)
- **Parallelizable**: yes, relative to 1.x (different file, no shared state) — but keep in the same PR per the single-PR review budget

## 3. Manual Verification (Chrome DevTools — no automated test runner exists)

Run after 1.1-1.5 are complete. Each procedure below maps to a spec scenario.

### 3.1 CoinGecko block → bounded completion [x]
- **Procedure**: DevTools → Network → block request pattern `*coingecko*`. Configure ≥1 crypto asset with quantity > 0. Trigger refresh.
- **Expected**: within ~10s the refresh completes; the refresh button re-enables; the spinner (`.spinning` class) is removed; toast reports failure(s).
- **Traces to**: spec.md "Scenario: CoinGecko endpoint never responds"

### 3.2 Alpha Vantage block → bounded completion [x]
- **Procedure**: Configure ≥1 stock asset with a valid ticker, quantity > 0, and a valid Alpha Vantage key in Settings. DevTools → Network → block `*alphavantage*`. Trigger refresh.
- **Expected**: within ~15s per ticker the refresh completes; button re-enables; spinner stops; toast reports failure.
- **Traces to**: spec.md "Scenario: Alpha Vantage endpoint never responds"

### 3.3 Frankfurter block → bounded completion, no hang [x]
- **Procedure**: Configure a stock asset whose `derivePriceCurrency` resolves to non-EUR (e.g. a `.LON` ticker → GBP). DevTools → Network → block `*frankfurter*`. Trigger refresh with a valid Alpha Vantage key.
- **Expected**: refresh completes within bound (15s AV + 8s Frankfurter ≈ 23s for that asset); does not hang; asset counted as failed (fetchFxRate returns 1 without caching, but the design's `1` fallback is a known non-blocking limitation — verify no infinite wait, not conversion correctness).
- **Traces to**: spec.md "Scenario: FX rate endpoint never responds"

### 3.4 Pacing interval intact under multiple stocks [x]
- **Procedure**: Configure 2+ stock assets with a valid Alpha Vantage key and no network blocking. Trigger refresh. Watch the Network panel timeline for request start times.
- **Expected**: ~12s gap between successive Alpha Vantage requests; no `429` responses.
- **Traces to**: spec.md "Scenario: Rate-limit pacing wait is not affected by the request timeout"; design.md CRITICAL constraint

### 3.5 Total failure does not advance `lastPriceUpdate` [x]
- **Procedure**: Note current `lastPriceUpdate` value via `localStorage` (Application tab or console). Block all provider endpoints (CoinGecko + Alpha Vantage, or go fully offline mid-refresh). Trigger refresh. Re-read `lastPriceUpdate`.
- **Expected**: value is unchanged from before the refresh; toast reports failure.
- **Traces to**: spec.md "Scenario: Total failure does not advance the stamp"; spec.md "Scenario: Total failure still releases the UI lock"

### 3.6 Partial success advances `lastPriceUpdate` [x]
- **Procedure**: Configure one crypto asset that will succeed and one stock asset that will fail (e.g. invalid ticker or blocked Alpha Vantage). Note `lastPriceUpdate`. Trigger refresh. Re-read `lastPriceUpdate`.
- **Expected**: value advances to the new refresh timestamp; toast reports both an update count and a failure count.
- **Traces to**: spec.md "Scenario: Partial success advances the stamp"; spec.md "Scenario: Timeout increments the failure count"

### 3.7 Missing Alpha Vantage key does not falsely advance the stamp [x]
- **Procedure**: Configure only stock assets, clear the Alpha Vantage key in Settings. Note `lastPriceUpdate`. Trigger refresh. Re-read `lastPriceUpdate`.
- **Expected**: `updated` is 0 for the skipped stocks; `lastPriceUpdate` does not advance; toast prompts to add an API key.
- **Traces to**: spec.md "Scenario: Missing Alpha Vantage key does not falsely advance the stamp"

### 3.8 Repeated total failures keep auto-refresh eligibility [x]
- **Procedure**: Set `lastPriceUpdate` in `localStorage` to a value >7 days old. Force a total-failure refresh (per 3.5). Confirm `lastPriceUpdate` is still >7 days old (unchanged). Reload the page.
- **Expected**: `scheduleAutoRefresh()` still considers the app eligible for its 7-day catch-up on next load (it fires `fetchPrices()` again rather than staying suppressed).
- **Traces to**: spec.md "Scenario: Repeated total failures do not push out auto-refresh eligibility"

### 3.9 Zero configured tickers does not advance the stamp [x]
- **Procedure**: Ensure no assets have `tickerSource` set (no crypto or stock tickers configured). Note `lastPriceUpdate`. Trigger refresh.
- **Expected**: toast reports "No assets configured for auto-update"; `updated` is 0; `lastPriceUpdate` unchanged.
- **Traces to**: spec.md "Scenario: Zero configured tickers does not advance the stamp"

### 3.10 Documentation structural readback [x]
- **Procedure**: Open `PHASE4_API_PRICES.md` and confirm line 3 no longer states "Planned — not yet implemented".
- **Traces to**: proposal.md Success Criteria ("`PHASE4_API_PRICES.md` no longer claims Phase 4 is unimplemented")

## Footprint Check

| Task | Est. changed lines |
|---|---|
| 1.1 helper | ~12 (new) |
| 1.2 fetchFxRate | ~4 |
| 1.3 CoinGecko | ~3 |
| 1.4 Alpha Vantage | ~3 |
| 1.5 stamp gate | ~3 |
| 2.1 doc header | ~1 |
| **Total** | **~26 lines**, well inside the 400-line review budget (single PR, no split needed) |
