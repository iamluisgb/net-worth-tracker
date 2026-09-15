# Design: Price Refresh Reliability

## Technical Approach

Introduce one local helper in `app.js` that performs `fetch` + `res.json()` under an `AbortController` bounded by a per-request timer, and route the three outbound calls of the refresh path through it: CoinGecko (`app.js:182`), Alpha Vantage (`app.js:209`), Frankfurter (`app.js:111`). Existing per-call `try/catch` failure counting is untouched — an abort surfaces as a rejection and is counted as a normal failure. Then gate `store.editSettings({ lastPriceUpdate })` (`app.js:237`) on `updated > 0`.

**Browser baseline (explicit assumption):** the repo declares no baseline (no `package.json`, no browserslist). `AbortSignal.timeout()` needs Chrome 103 / Safari 16 / Firefox 100 (mid-2022); `AbortController` + `setTimeout` needs Chrome 66 / Safari 11.1 (2018). Because this is an installable PWA whose iOS Safari version is tied to the OS, the design uses the wider-support form. If the team later declares a 2022+ baseline, `AbortSignal.timeout()` is a drop-in simplification.

## Architecture Decisions

### Decision: Timeout values — 10s CoinGecko, 15s Alpha Vantage, 8s Frankfurter

| Option | Tradeoff | Decision |
|---|---|---|
| One value for all three | Simple, but ignores that the three endpoints have very different latency profiles and failure costs | Rejected |
| 5s everywhere | Aborts slow-but-valid Alpha Vantage responses under load; turns valid data into `failed++` | Rejected |
| 30s everywhere | Bounded in theory, but a 3-stock refresh becomes ~2 min of spinner; users read that as a hang | Rejected |
| Per-endpoint: 10s / 15s / 8s | Slightly more surface, matches real profiles | **Chosen** |

Rationale. **Alpha Vantage 15s**: slowest and least predictable of the three, and its loop is *already* paced at 12s per iteration (`app.js:206`), so a 15s bound raises worst-case per-asset wall time from 12s to 27s — proportionally small against a cost the flow already accepts. **CoinGecko 10s**: a single edge-cached batch call; 10s is generous and, because it is one call, it is the whole crypto branch's bound. **Frankfurter 8s**: it runs *nested inside* the Alpha Vantage iteration (`app.js:214`), so its timeout stacks on top of the 15s one; the tighter value keeps the per-stock worst case at 12 + 15 + 8 = 35s instead of pushing past a minute.

Secondary: `fetchFxRate` caches its failure fallback (`_fxCache[key] = 1`, `app.js:115`), which poisons the cache for the whole session and silently records USD prices as EUR. With timeouts this becomes easier to trigger, so the failure path MUST return `1` **without writing it to `_fxCache`**. The `1` fallback itself stays (changing conversion semantics is out of scope and `app.js:1074` is a second caller).

### Decision: A CoinGecko batch timeout keeps all-or-nothing semantics

**Choice**: a timeout on the batch request keeps `failed += cryptoAssets.length` (`app.js:193-195`) unchanged.
**Alternatives**: (a) retry aborted assets one-by-one — turns one call into N calls against a free, rate-limited endpoint, invites 429s, and multiplies the time bound the change exists to impose; (b) count the batch as a single failure — undercounts, and the toast at `app.js:233` would tell the user "1 failed" when 12 assets were not updated.
**Rationale**: CoinGecko is one batched HTTP call for all crypto assets. If it aborts, zero price data arrived for *any* of them; all-or-nothing is not a simplification here, it is the truthful accounting. Per-asset granularity is not a property the transport can provide.

### Decision: Local helper in `app.js`, not a new module

**Choice**: `const fetchJson = async (url, timeoutMs) => {...}` declared just above `_fxCache` (`app.js:~104`), in the existing `const` arrow style.
**Alternatives**: a new `net.js` / `utils.js` module; or inline `AbortController` at each of the three call sites.
**Rationale**: the repo has exactly four JS files split by responsibility (`store` state, `drive` sync, `sw` cache, `app` UI + network) and no utility module. All three consumers live in `app.js`; a new module adds an import and a file for zero cross-file reuse. Inlining triplicates timer/cleanup logic — exactly the drift this change fixes. `app.js` length is real but is a separate concern, and a 12-line helper is not the refactor that fixes it.

### Decision: The timer covers the request AND the body read

The helper clears its timer in a `finally` **after** `res.json()` resolves, not when `fetch()` resolves. `fetch()` settles on response headers; a stalled body stream would otherwise re-open the unbounded wait the change is removing. `AbortController` covers body streaming while the signal is live.

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

## CRITICAL — do not bound the pacing wait

`await new Promise(r => setTimeout(r, 12000))` at **`app.js:206` is deliberate rate limiting** for Alpha Vantage's 5-requests-per-minute free tier. It is not a hang.

- The timeout MUST bound **each HTTP request only**.
- It MUST NOT wrap the `for` loop (`app.js:205-223`), the pacing `await` (`app.js:206`), or the outer `try` (`app.js:176`).
- Wrapping the loop in a single timeout would abort mid-pacing, collapse the interval, and produce 429s.

## Data Flow

    fetchPrices ──→ fetchJson(CoinGecko, 10s) ──→ upsertUpdate ──→ store
         │                                            ↑
         ├─ for each stock:                           │
         │     wait 12s (pacing — NOT bounded)        │
         │     fetchJson(AlphaVantage, 15s) ──────────┤
         │       └─ fetchFxRate ──→ fetchJson(Frankfurter, 8s)
         │
         └─ updated > 0 ? store.editSettings({lastPriceUpdate}) : skip
                              │
                              └──→ scheduleAutoRefresh (app.js:296-300)

## Freshness-stamp gating

`store.editSettings({ lastPriceUpdate })` runs **iff `updated > 0`**. `updated` is incremented only where a price was parsed and an update row was written (`app.js:188`, `app.js:216`), so it is already the exact "an asset actually changed" counter.

| Case | `updated` | Stamp | Consequence |
|---|---|---|---|
| All requests failed / aborted | 0 | No | 7-day catch-up stays armed |
| Missing Alpha Vantage key (`app.js:202`), stocks only | 0 | No | Fixes the suppression named in the proposal |
| Missing key, but crypto succeeded | >0 | Yes | Partial success is still a real refresh |
| Zero configured tickers (`totalConfigured === 0`) | 0 | No | See note below |
| Partial success (some failed) | >0 | Yes | Stamp is a catch-up heuristic, not a completeness claim |

Partial success stamps deliberately: requiring full success would re-fire the 12s-paced Alpha Vantage loop on every load for one permanently-broken ticker.

Zero-ticker note: a user with no tickers and a pre-existing `lastPriceUpdate` older than 7 days will have `scheduleAutoRefresh` call `fetchPrices()` on every load. Both asset lists are empty, so **no network request is made** — the cost is one synchronous no-op plus the existing toast. Accepted; a cheaper guard belongs to a separate change.

## try/finally reachability

Confirmed reachable under this design. Every `await` in the refresh path is now either the bounded `fetchJson` (abort rejects the promise) or the finite 12s pacing timer. Every `fetchJson` call sits inside an existing `try/catch` (`app.js:181`, `app.js:208`, `app.js:110`), so rejections are absorbed into `failed++` and control always reaches `app.js:237-241`: spinner class removed, button re-enabled.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app.js` (~104) | Modify | Add `fetchJson` helper above `_fxCache` |
| `app.js:110-117` | Modify | `fetchFxRate` uses `fetchJson(url, 8000)`; stop caching the failure fallback |
| `app.js:182-183` | Modify | CoinGecko via `fetchJson(url, 10000)`; batch catch unchanged |
| `app.js:209-210` | Modify | Alpha Vantage via `fetchJson(url, 15000)`; pacing at `:206` untouched |
| `app.js:237` | Modify | Gate stamp on `updated > 0` |
| `PHASE4_API_PRICES.md:3` | Modify | Status header correction (documentation only) |

## Interfaces / Contracts

`fetchJson(url: string, timeoutMs: number) => Promise<any>` — resolves parsed JSON; rejects on network error, abort (`AbortError`), or JSON parse error. Callers do not distinguish abort from other failures; all count as `failed`. No storage schema change; `lastPriceUpdate` keeps its ISO-string shape.

## Testing Strategy

No test runner exists (`openspec/config.yaml` `strict_tdd: false`); verification is manual in Chrome DevTools.

| Layer | What to verify | Approach |
|---|---|---|
| Bounded time | Refresh terminates, button re-enables, spinner stops | DevTools → Network request blocking on `api.coingecko.com`, then refresh |
| Bounded time | Same under a stalled connection | Network throttling → Offline mid-refresh |
| Truthfulness | `lastPriceUpdate` unchanged after an all-failed refresh | Read `localStorage` before/after |
| Truthfulness | `lastPriceUpdate` advances after partial success | One valid + one bogus ticker |
| Missing key | Stocks-only portfolio, no AV key → stamp not written | Clear key in Settings, refresh, read `localStorage` |
| Pacing intact | Two stocks → ~12s gap between AV requests, no 429 | Network panel timeline |
| Docs | Header no longer claims "Planned" | Structural readback |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Changes are confined to browser `fetch` calls and one localStorage field.

## Backward Compatibility / Migration

No migration required. No storage schema change, no persisted-data transformation, no new dependency, no build step. The only observable behavior change for existing users: a `lastPriceUpdate` that would previously have been written on a fully failed refresh is now left alone, which can allow the 7-day catch-up to fire once — the intended fix. Rollback is a single-commit revert.

## Open Questions

- [ ] None blocking. Optional follow-ups outside this change: replacing the FX `rate = 1` fallback with an explicit per-asset failure, and a cheap guard so `scheduleAutoRefresh` skips portfolios with zero configured tickers.
