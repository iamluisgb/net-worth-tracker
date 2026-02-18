# Phase 4 — Auto Price Updates via Free APIs

> **Status:** Planned — not yet implemented

## Overview

Automatically refresh asset prices once a week (or on demand) using free public APIs. No backend required — everything runs in the browser.

---

## APIs to Use

| API | For | API Key | Limits | EUR |
|-----|-----|---------|--------|-----|
| [CoinGecko](https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur) | Crypto | None needed | ~30 req/min | ✅ Native |
| [Alpha Vantage](https://www.alphavantage.co) | Stocks, ETFs | Free (get it [here](https://www.alphavantage.co/support/#api-key)) | 25 req/day, 5/min | ⚠️ USD → convert |
| [Frankfurter](https://api.frankfurter.app/latest?from=USD&to=EUR) | USD→EUR rate | None needed | Unlimited | ✅ |

- **Real Estate, Debt, Cash, Other** → always manual, no auto-update (no API makes sense)

---

## New Asset Fields

Two optional fields added to each asset (backward-compatible):

```
ticker       — e.g. "bitcoin", "AAPL", "SWDA.LON"
tickerSource — "coingecko" | "alphavantage" | "" (auto-derived from category)
```

Category → source mapping:
- `Crypto` → `coingecko`
- `Stocks` / `Funds` → `alphavantage`
- Everything else → `""` (no auto-update)

---

## New Settings Fields

```
alphaVantageKey  — user pastes their free AV key once in Settings
lastPriceUpdate  — ISO date string, set after each refresh (drives auto-refresh logic)
```

---

## Features to Build

### 1. Ticker field in Add/Edit Asset modal
- Only shown for Crypto, Stocks, Funds categories
- Hint text changes per category:
  - Crypto: *"CoinGecko coin ID — e.g. bitcoin, ethereum, solana"*
  - Stocks/Funds: *"Exchange ticker — e.g. AAPL, MSFT, SWDA.LON"*

### 2. Alpha Vantage API key in Settings
- Text input with link to get the free key
- Stored in `settings.alphaVantageKey`

### 3. Refresh button (near net worth total)
- Manual trigger with spinning icon while fetching
- Shows toast with results: *"Updated 3 assets"* / *"2 failed"* / *"No assets configured"*

### 4. Auto-refresh on app load
- If `lastPriceUpdate` exists and is ≥7 days old → silently refresh in background
- If never refreshed manually → does nothing (user hasn't set up tickers yet)

---

## Files to Modify

| File | What changes |
|------|-------------|
| `store.js` | Add `alphaVantageKey`, `lastPriceUpdate` to `defaultState.settings`; add `editSettings()` action |
| `style.css` | Add `@keyframes spin` + `.spinning` class for refresh icon |
| `index.html` | Ticker input in asset form; AV key input in settings modal; refresh button near net worth |
| `app.js` | `deriveSource()`, `updateTickerVisibility()`, `fetchPrices()`, `scheduleAutoRefresh()`, wiring |

---

## Core Logic — `fetchPrices()`

```
1. Collect assets with tickerSource = 'coingecko' and quantity > 0
   → One batch GET to CoinGecko with all coin IDs
   → For each result: addTransaction({ type: 'update', amount: price_eur × quantity })

2. Collect assets with tickerSource = 'alphavantage' and quantity > 0
   → GET Frankfurter for USD/EUR rate (one call)
   → For each stock asset (sequential, 12s delay between calls due to 5/min limit):
       GET Alpha Vantage GLOBAL_QUOTE for ticker
       → addTransaction({ type: 'update', amount: price_usd × usd_eur_rate × quantity })

3. Save settings.lastPriceUpdate = now
4. Show toast with summary
```

---

## Edge Cases

- No tickers configured → toast: *"No assets configured for auto-update"*
- Stock tickers set but no AV key → toast: *"Add an Alpha Vantage API key in Settings"*
- Bad CoinGecko coin ID → that asset counted as "failed" in the toast
- Asset has no quantity → skipped (can't compute total value from unit price)
- Multiple assets with same ticker (e.g. 2 Ethereum wallets) → each fetched/updated independently (CoinGecko batches them in one API call anyway)

---

## Implementation Order

1. `store.js` — settings fields + `editSettings()`
2. `style.css` — spin animation
3. `index.html` — ticker field, AV key field, refresh button
4. `app.js` — all helpers and logic

---

## Testing Checklist

- [ ] Crypto asset with ticker "bitcoin" → refresh → value updates to EUR price × quantity
- [ ] Stock asset with ticker "AAPL" + AV key in settings → refresh → value updates (USD→EUR converted)
- [ ] Real Estate asset → ticker field not shown in modal
- [ ] `lastPriceUpdate` set to 8 days ago in localStorage → reload app → auto-refresh fires
- [ ] Click refresh with no tickers configured → correct toast message
- [ ] Stock ticker set but no AV key → correct toast message
