# My Worth Tracker

Private, local-first net worth tracker. Vanilla JavaScript PWA, no build step,
no dependencies, no backend: the portfolio lives in `localStorage` and can be
backed up to the user's own Google Drive `appDataFolder`.

Live: <https://luisgonzalezbernal.com/net-worth-tracker/>

## Files

| File | Responsibility |
| --- | --- |
| `index.html` | Markup, modals, CDN scripts (pinned + SRI) |
| `app.js` | Rendering, forms, charts, price refresh, Drive UI |
| `store.js` | State, ledger replay, snapshots, import/export |
| `fx.js` | FX rates from Frankfurter with a validated cache |
| `drive.js` | Google Drive backup/restore/auto-sync |
| `sw.js` | Offline shell (scope-relative, network-first) |
| `store.test.js`, `fx.test.js` | `node:test` suites |
| `openspec/` | Specs and change history |

## Development

No install step. Serve the folder over HTTP (ES modules and service workers do
not work from `file://`):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Run the tests (Node >= 18.19):

```bash
node --test        # or: npm test
```

## Data model

- All amounts are stored in EUR. Assets keep their native `currency` and
  `quantity` for display and price updates.
- Dates are local `YYYY-MM-DD` keys, never timestamps.
- `transactions` is the source of truth; `assets.currentValue` is a cache
  rebuilt by replaying the ledger (`recalculateState`).
- `snapshots` stores one net-worth value per day, recorded on every change, so
  the history chart has real points even on days without transactions.
- `category: 'Debt'` always reduces net worth (`signedValue`), regardless of
  whether the user entered the amount as positive or negative.
- Moving value between assets is stored as a `sell` + `buy` pair; the UI's
  "Move" filter matches the generated notes.

## Deploy

Pushing to `master` publishes `master` root through GitHub Pages. The `test`
workflow (`.github/workflows/test.yml`) runs on every push, but Pages does not
wait for it: check the Actions tab after pushing.

## Constraints

- No bundler and no dependencies. `package.json` only declares
  `"type": "module"` and the `test` script.
- The origin (`luisgonzalezbernal.com`) is shared with other GitHub Pages
  projects, so the service worker only deletes caches named `my-worth-*` or
  `purse-*`.
