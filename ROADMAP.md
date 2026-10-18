# Roadmap

Backlog after the 2026-10 audit. Ordered by risk, not by novelty.

## Done in the audit pass

- FX cache only stores validated rates; `fetchJson` rejects non-OK responses.
- Service worker installs again under `/net-worth-tracker/`, network-first for
  the app shell, and no longer deletes other projects' caches.
- Same-day transactions replay in insertion order; the history chart matches
  the balance.
- Sells and moves above the available quantity are rejected.
- Partial sales keep a proportional (average-cost) cost basis.
- Imports merge defaults, validate the payload and recalculate values.
- Full localStorage reports an error instead of losing writes silently.
- One net-worth snapshot per day, so history has points on days without moves.
- `Debt` always reduces net worth; dashboard splits assets vs liabilities.
- Goal target + monthly contribution with a simple projection.
- One visibility predicate for total, trend, chart, treemap and share.
- Stored XSS via imported names/tickers escaped before `innerHTML`.
- Accessible dialogs (focus trap, Escape, focus restore), zoom re-enabled,
  4.5:1 muted text, reduced-motion support.
- PNG icons, maskable manifest entry, apple-touch-icon.
- Price refresh no longer waits 12s per ticker: five requests in flight, a
  10-minute per-ticker cache and fail-fast on the Alpha Vantage daily limit.
- `node:test` suites (42 tests) and a CI workflow.

## P0 — data safety

1. **Google Drive is last-write-wins.** `syncOnLoad` compares the Drive file's
   `modifiedTime` with a local "last sync" timestamp, so edits made offline on
   one device can be overwritten by the other device without warning.
   - Track a real local `lastChange` timestamp and skip auto-restore when the
     local state changed since the last sync; offer "keep local" vs "restore".
   - Write rotating dated backups (keep ~14) instead of a single file.
   - Add a merge-by-id strategy (assets and transactions have UUIDs) for the
     common non-overlapping case.
   - Files: `drive.js`, `app.js` (`startDrive`, `visibilitychange`).

2. **Editing a transaction can still create negative holdings.** The form
   validates new sells, but `editTransaction` replays without checking the
   resulting quantity. Add a dry-run replay and reject an edit that leaves any
   asset below zero. File: `store.js` (`editTransaction`).

3. **Import schema versioning.** `importData` accepts old files but there is no
   `schemaVersion` and no migration step. Add one before changing the data
   shape again. File: `store.js`.

## P1 — product

4. **Real returns.** Average-cost gain is now correct, but it is still a simple
   return. Add money-weighted return (XIRR) from dated cash flows, and show
   contributions vs market gains per period.
5. **CSV import** from brokers (positions + operations), with a column mapper
   and preview. Removes the main reason to abandon the app after a few months.
6. **Encrypted backups.** The Drive backup is plain JSON in the user's private
   app data folder. Encrypt with a passphrase (WebCrypto AES-GCM) before upload.
7. **Price refresh**: pacing is fixed (5 in flight, no artificial waits,
   10-minute cache, fail-fast on the 25/day cap). Still missing: a progress
   bar with cancellation and a provider with batching for portfolios above 25
   tickers. Evaluate Twelve Data or Finnhub. Files: `app.js` (`fetchPrices`).
8. **Privacy mode / app lock.** A blur toggle for screenshots and a local PIN
   gate for a device shared with others.
9. **Rebalancing**: compare current allocation with a target per asset class
   and show the buy/sell delta. The treemap already computes the distribution.
10. **Currency**: `settings.currency` is unused; `formatCurrency` is hardcoded
    to EUR/es-ES. Either remove the setting or implement display conversion and
    a currency selector.

## P2 — engineering

11. **Split `app.js`** (1,900 lines) into modules (render, forms, charts, sync).
    Top-level DOM lookups currently prevent importing it in tests; the store is
    the only testable module.
12. **Performance**: `getAssetCostBasis` filters and replays the whole ledger
    per asset, and `getHistory` is rebuilt several times per render. Memoize
    per state revision once portfolios exceed a few thousand transactions.
13. **E2E smoke test** (Playwright) covering add asset, add move, reject sell,
    import/export and offline reload. The 2026-10 pass used a local jsdom
    harness; it is not in the repo because it would add a dependency.
14. **i18n**: the dashboard is English while the tutorial, toasts and
    confirmations are Spanish. Pick one language or add a locale switch.
15. **Date helpers**: month arithmetic in `filterByRange` can overflow
    (`setMonth` on the 31st). Use an explicit end-of-month clamp.
16. **CSS**: most spacing is inline. Move the repeated inline styles into
    utility classes when the UI is next touched.

## Known limitations

- No backend: prices and FX are fetched from the browser, so the Alpha Vantage
  key lives in `localStorage` and is sent to their API.
- The app is EUR-only even though assets can be entered in other currencies.
- Snapshots start on the day this version was installed; earlier history still
  comes only from recorded transactions.
- The Pages deployment does not wait for the `test` workflow; check the Actions
  tab after pushing to `master`.
