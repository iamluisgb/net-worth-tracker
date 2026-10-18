import { store, signedValue, localDateKey } from './store.js';
import { mapWithConcurrency } from './concurrency.js';
import {
    getCachedPrice, putCachedPrice, parseAlphaVantageQuote,
    parseCoinGeckoPrice, formatFailures
} from './prices.js';
import { fetchJson, fetchFxRate } from './fx.js';
import {
    initDrive, backupToDrive, restoreFromDrive,
    silentBackup, syncOnLoad, onSyncStatus,
    isSyncing, clearStoredToken
} from './drive.js';

// --- Filter State ---
let hiddenCategories = new Set();
let hiddenAssetClasses = new Set();
let selectedDateRange = 'MAX';

// Single source of truth for the visible portfolio: the dashboard total, the
// trend, the chart, the treemap and the share breakdown must agree.
const isVisibleAsset = (asset) =>
    !hiddenCategories.has(asset.category) &&
    (!asset.assetClass || !hiddenAssetClasses.has(asset.assetClass));

const getVisibleAssets = () => store.state.assets.filter(isVisibleAsset);

// Trim history labels/data to the selected date range
const filterByRange = (labels, data, range) => {
    if (range === 'MAX' || !labels.length) return { labels, data };
    const now = new Date();
    const start = new Date(now);
    switch (range) {
        case '1M': start.setMonth(now.getMonth() - 1); break;
        case '3M': start.setMonth(now.getMonth() - 3); break;
        case '6M': start.setMonth(now.getMonth() - 6); break;
        case 'YTD': start.setMonth(0); start.setDate(1); break;
        case '1Y': start.setFullYear(now.getFullYear() - 1); break;
    }
    const startStr = start.toISOString().split('T')[0];
    const idx = labels.findIndex(l => l >= startStr);
    if (idx === -1) return { labels, data };
    return { labels: labels.slice(idx), data: data.slice(idx) };
};

// --- Demo Portfolio Data ---
const DEMO_DATA = {
    settings: { currency: 'EUR', theme: 'dark', alphaVantageKey: '', lastPriceUpdate: null },
    assets: [
        { id: 'demo-aapl', name: 'Apple Inc', type: 'manual', category: 'Stocks', assetClass: 'Renta Variable', currency: 'EUR', ticker: 'AAPL', tickerSource: 'alphavantage', currentValue: 5200, quantity: 30 },
        { id: 'demo-vwra', name: 'Vanguard FTSE All-World', type: 'manual', category: 'Funds', assetClass: 'Renta Variable', currency: 'EUR', ticker: 'VWRA.AMS', tickerSource: 'alphavantage', currentValue: 4350, quantity: 50 },
        { id: 'demo-bond', name: 'Fondo Renta Fija EUR', type: 'manual', category: 'Funds', assetClass: 'Renta Fija', currency: 'EUR', ticker: '', tickerSource: '', currentValue: 5480, quantity: 0 },
        { id: 'demo-btc', name: 'Bitcoin', type: 'manual', category: 'Crypto', assetClass: 'Alternativo', currency: 'EUR', ticker: 'bitcoin', tickerSource: 'coingecko', currentValue: 2800, quantity: 0.032 },
        { id: 'demo-cash', name: 'Cuenta de Ahorro', type: 'manual', category: 'Cash', assetClass: 'Liquidez', currency: 'EUR', ticker: '', tickerSource: '', currentValue: 5200, quantity: 0 }
    ],
    transactions: [
        // Apple — buy + annual updates
        { id: 'demo-tx-01', assetId: 'demo-aapl', type: 'buy',    date: '2023-02-15', amount: 3500, quantity: 30, notes: 'Compra inicial' },
        { id: 'demo-tx-02', assetId: 'demo-aapl', type: 'update', date: '2023-09-01', amount: 3900, quantity: 30, notes: '' },
        { id: 'demo-tx-03', assetId: 'demo-aapl', type: 'update', date: '2024-06-01', amount: 4600, quantity: 30, notes: '' },
        { id: 'demo-tx-04', assetId: 'demo-aapl', type: 'update', date: '2025-01-15', amount: 4950, quantity: 30, notes: '' },
        { id: 'demo-tx-05', assetId: 'demo-aapl', type: 'update', date: '2026-02-01', amount: 5200, quantity: 30, notes: '' },
        // Vanguard ETF
        { id: 'demo-tx-06', assetId: 'demo-vwra', type: 'buy',    date: '2023-04-10', amount: 3000, quantity: 50, notes: 'Compra inicial' },
        { id: 'demo-tx-07', assetId: 'demo-vwra', type: 'update', date: '2024-01-10', amount: 3450, quantity: 50, notes: '' },
        { id: 'demo-tx-08', assetId: 'demo-vwra', type: 'update', date: '2025-01-10', amount: 3900, quantity: 50, notes: '' },
        { id: 'demo-tx-09', assetId: 'demo-vwra', type: 'update', date: '2026-02-01', amount: 4350, quantity: 50, notes: '' },
        // Bond fund
        { id: 'demo-tx-10', assetId: 'demo-bond', type: 'buy',    date: '2023-01-05', amount: 5000, quantity: 0, notes: 'Aportación inicial' },
        { id: 'demo-tx-11', assetId: 'demo-bond', type: 'update', date: '2024-01-05', amount: 5150, quantity: 0, notes: '' },
        { id: 'demo-tx-12', assetId: 'demo-bond', type: 'update', date: '2025-01-05', amount: 5320, quantity: 0, notes: '' },
        { id: 'demo-tx-13', assetId: 'demo-bond', type: 'update', date: '2026-02-01', amount: 5480, quantity: 0, notes: '' },
        // Bitcoin
        { id: 'demo-tx-14', assetId: 'demo-btc',  type: 'buy',    date: '2023-10-20', amount: 800,  quantity: 0.032, notes: 'Primera compra BTC' },
        { id: 'demo-tx-15', assetId: 'demo-btc',  type: 'update', date: '2024-03-15', amount: 2200, quantity: 0.032, notes: '' },
        { id: 'demo-tx-16', assetId: 'demo-btc',  type: 'update', date: '2025-01-10', amount: 1600, quantity: 0.032, notes: '' },
        { id: 'demo-tx-17', assetId: 'demo-btc',  type: 'update', date: '2026-02-01', amount: 2800, quantity: 0.032, notes: '' },
        // Savings
        { id: 'demo-tx-18', assetId: 'demo-cash', type: 'buy',    date: '2023-01-01', amount: 5000, quantity: 0, notes: 'Saldo inicial' },
        { id: 'demo-tx-19', assetId: 'demo-cash', type: 'update', date: '2024-01-01', amount: 5080, quantity: 0, notes: '' },
        { id: 'demo-tx-20', assetId: 'demo-cash', type: 'update', date: '2025-01-01', amount: 5150, quantity: 0, notes: '' },
        { id: 'demo-tx-21', assetId: 'demo-cash', type: 'update', date: '2026-02-01', amount: 5200, quantity: 0, notes: '' }
    ]
};

// --- Drive Sync Helpers ---
const AUTOSYNC_KEY = 'nwtAutoSync';
const isAutoSync = () => localStorage.getItem(AUTOSYNC_KEY) === '1';

function debounce(fn, ms) {
    let t;
    return Object.assign((...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); },
        { flush: (...args) => { clearTimeout(t); fn(...args); } });
}

function updateDriveSyncUI() {
    const btn = document.getElementById('btn-auto-sync');
    const desc = document.getElementById('auto-sync-desc');
    if (!btn) return;
    if (isAutoSync()) {
        btn.classList.add('active');
        if (desc) desc.textContent = 'Activada — sincronizando con Drive';
    } else {
        btn.classList.remove('active');
        if (desc) desc.textContent = 'Desactivada';
    }
}

// --- Utils ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(amount);
};

// User-controlled strings (asset names, imported tickers, notes) must never be
// interpolated into innerHTML unescaped.
const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// --- Phase 4: Price Auto-Update ---

const deriveSource = (category) => {
    if (category === 'Crypto') return 'coingecko';
    if (category === 'Stocks' || category === 'Funds') return 'alphavantage';
    return '';
};

const derivePriceCurrency = (ticker) => {
    if (!ticker) return 'USD';
    const t = ticker.toUpperCase();
    if (t.endsWith('.LON')) return 'GBP';
    if (t.endsWith('.AMS') || t.endsWith('.DEX') || t.endsWith('.PAR') ||
        t.endsWith('.EPA') || t.endsWith('.EBR')) return 'EUR';
    return 'USD';
};

const updateTickerVisibility = () => {
    const category = document.getElementById('asset-category')?.value || '';
    const group = document.getElementById('group-ticker');
    const hint = document.getElementById('ticker-hint');
    if (!group) return;
    const source = deriveSource(category);
    if (source) {
        group.classList.remove('hidden');
        if (hint) hint.textContent = source === 'coingecko'
            ? '— e.g. bitcoin, ethereum, solana'
            : '— e.g. AAPL, MSFT, SWDA.LON';
    } else {
        group.classList.add('hidden');
        if (hint) hint.textContent = '';
    }
};

const upsertUpdate = (assetId, date, amount, notes = '') => {
    const existing = store.state.transactions.find(
        t => t.assetId === assetId && t.type === 'update' && localDateKey(t.date) === date
    );
    if (existing) {
        store.editTransaction(existing.id, { amount, notes });
    } else {
        store.addTransaction({ assetId, type: 'update', date, amount, notes });
    }
};

let priceRefreshRunning = false;

const fetchPrices = async ({ force = false } = {}) => {
    if (priceRefreshRunning) return;
    priceRefreshRunning = true;

    const btn = document.getElementById('btn-refresh-prices');
    const icon = document.getElementById('refresh-icon');
    const statusEl = document.getElementById('price-refresh-status');
    if (icon) icon.classList.add('spinning');
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }

    const today = localDateKey();
    const assets = store.state.assets;
    const cryptoAssets = assets.filter(a => a.tickerSource === 'coingecko' && a.ticker && Number(a.quantity) > 0);
    const stockAssets = assets.filter(a => a.tickerSource === 'alphavantage' && a.ticker && Number(a.quantity) > 0);
    const totalConfigured = cryptoAssets.length + stockAssets.length;

    let cache = { ...(store.state.settings?.priceCache || {}) };
    let fetched = 0;
    let cached = 0;
    let failed = 0;
    let skippedByLimit = 0;
    let done = 0;
    let rateLimitMessage = '';
    const failures = [];
    const pending = [];

    const setStatus = (label) => {
        if (!statusEl) return;
        statusEl.textContent = label;
        statusEl.hidden = !label;
    };
    const advance = (label) => {
        done++;
        if (!totalConfigured) return;
        setStatus(`Actualizando precios… ${done}/${totalConfigured}${label ? ` · ${label}` : ''}`);
    };
    const queue = (asset, eur) => pending.push({ asset, eur });

    // Apply everything collected so far in one store notification and one save,
    // instead of re-rendering the whole dashboard once per asset.
    const flush = () => {
        if (!pending.length) return;
        const queued = pending.splice(0);
        store.batch(() => {
            queued.forEach(({ asset, eur }) => {
                try {
                    upsertUpdate(asset.id, today, eur * Number(asset.quantity), 'Auto price update');
                } catch {
                    failed++;
                }
            });
            store.editSettings({ priceCache: cache });
        });
    };

    try {
        if (totalConfigured === 0) {
            showToast('No assets configured for auto-update. Add tickers in asset settings.');
            return;
        }

        // --- CoinGecko (Crypto): one batched request ---
        const cryptoToFetch = [];
        for (const asset of cryptoAssets) {
            const hit = force ? null : getCachedPrice(cache, 'coingecko', asset.ticker);
            if (hit) {
                queue(asset, hit.eur);
                cached++;
                advance(asset.ticker);
            } else {
                cryptoToFetch.push(asset);
            }
        }

        if (cryptoToFetch.length > 0) {
            const ids = cryptoToFetch.map(a => a.ticker).join(',');
            try {
                const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur`, 10000);
                for (const asset of cryptoToFetch) {
                    const parsed = parseCoinGeckoPrice(data, asset.ticker);
                    if (parsed.price) {
                        cache = putCachedPrice(cache, 'coingecko', asset.ticker, parsed.price);
                        queue(asset, parsed.price);
                        fetched++;
                    } else {
                        failed++;
                        failures.push(asset.ticker);
                    }
                    advance(asset.ticker);
                }
            } catch {
                for (const asset of cryptoToFetch) {
                    failed++;
                    failures.push(asset.ticker);
                    advance(asset.ticker);
                }
            }
        }
        flush();

        // --- Alpha Vantage (Stocks/Funds): 5 requests/minute, burst first ---
        const stockToFetch = [];
        for (const asset of stockAssets) {
            const hit = force ? null : getCachedPrice(cache, 'alphavantage', asset.ticker);
            if (hit) {
                queue(asset, hit.eur);
                cached++;
                advance(asset.ticker);
            } else {
                stockToFetch.push(asset);
            }
        }

        if (stockToFetch.length > 0) {
            const avKey = store.state.settings.alphaVantageKey;
            if (!avKey) {
                for (const asset of stockToFetch) {
                    failed++;
                    failures.push(asset.ticker);
                    advance(asset.ticker);
                }
                showToast('Add an Alpha Vantage API key in Settings to update stocks', true, 6000);
            } else {
                // The free tier is 25 requests/day with no documented
                // per-minute window, so keep five in flight and no artificial
                // delay (the old code waited 12s before every ticker).
                await mapWithConcurrency(stockToFetch, 5, async (asset) => {
                    if (rateLimitMessage) {
                        skippedByLimit++;
                        advance(asset.ticker);
                        return;
                    }
                    try {
                        const data = await fetchJson(
                            `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(asset.ticker)}&apikey=${avKey}`,
                            15000
                        );
                        const parsed = parseAlphaVantageQuote(data);
                        if (parsed.error === 'rate-limit') {
                            rateLimitMessage = parsed.message;
                            failed++;
                            failures.push(asset.ticker);
                        } else if (parsed.error) {
                            failed++;
                            failures.push(asset.ticker);
                        } else {
                            const priceCurrency = derivePriceCurrency(asset.ticker);
                            const fxRate = priceCurrency === 'EUR' ? 1 : await fetchFxRate(priceCurrency, 'EUR');
                            const eur = parsed.price * fxRate;
                            cache = putCachedPrice(cache, 'alphavantage', asset.ticker, eur);
                            queue(asset, eur);
                            fetched++;
                        }
                    } catch {
                        failed++;
                        failures.push(asset.ticker);
                    }
                    advance(asset.ticker);
                });
            }
        }
        flush();

        const parts = [];
        if (fetched > 0) parts.push(`Updated ${fetched}`);
        if (cached > 0) parts.push(`${cached} from cache`);
        if (failed > 0) parts.push(`${failed} failed${failures.length ? `: ${formatFailures(failures)}` : ''}`);
        if (skippedByLimit > 0) parts.push(`${skippedByLimit} skipped`);
        if (rateLimitMessage) parts.push('Alpha Vantage limit reached');
        showToast(parts.join(' · ') || 'No prices to update', failed > 0, failed > 0 ? 9000 : 5000);

        if (fetched > 0) {
            // Only a real network success advances the freshness stamp.
            store.editSettings({ lastPriceUpdate: new Date().toISOString() });
        }
    } finally {
        flush();
        if (icon) icon.classList.remove('spinning');
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
        setStatus('');
        priceRefreshRunning = false;
    }
};

const renderTickerBulkList = () => {
    const container = document.getElementById('ticker-bulk-list');
    if (!container) return;
    const eligible = store.state.assets.filter(a => deriveSource(a.category));
    if (!eligible.length) {
        container.innerHTML = '<p class="text-sm text-muted">No Stocks, Funds or Crypto assets yet.</p>';
        return;
    }
    container.innerHTML = eligible.map(a => `
        <div class="ticker-bulk-row">
            <span class="ticker-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
            <span class="ticker-bulk-badge">${a.category === 'Crypto' ? 'CoinGecko' : 'AV'}</span>
            <input type="text" data-asset-id="${a.id}" data-category="${escapeHtml(a.category)}"
                value="${escapeHtml(a.ticker || '')}" placeholder="${a.category === 'Crypto' ? 'bitcoin' : 'AAPL'}">
        </div>`).join('');
};

const applyTickerJson = () => {
    const raw = document.getElementById('ticker-json-input')?.value || '';
    const statusEl = document.getElementById('ticker-bulk-status');
    let map;
    try {
        map = JSON.parse(raw);
    } catch {
        if (statusEl) statusEl.textContent = 'Invalid JSON.';
        return;
    }
    let applied = 0;
    store.state.assets.forEach(a => {
        const ticker = (map[a.name] || '').trim();
        if (ticker) {
            store.editAsset(a.id, { ticker, tickerSource: deriveSource(a.category) });
            applied++;
        }
    });
    renderTickerBulkList();
    if (statusEl) statusEl.textContent = `Applied ${applied} ticker${applied !== 1 ? 's' : ''}.`;
};

const saveAllTickers = () => {
    const rows = document.querySelectorAll('#ticker-bulk-list input[data-asset-id]');
    rows.forEach(input => {
        const id = input.dataset.assetId;
        const category = input.dataset.category;
        const ticker = input.value.trim();
        const tickerSource = ticker ? deriveSource(category) : '';
        store.editAsset(id, { ticker, tickerSource });
    });
    const statusEl = document.getElementById('ticker-bulk-status');
    if (statusEl) statusEl.textContent = `Saved ${rows.length} ticker${rows.length !== 1 ? 's' : ''}.`;
};

const scheduleAutoRefresh = () => {
    const lastUpdate = store.state.settings?.lastPriceUpdate;
    if (!lastUpdate) return;
    const daysSince = (Date.now() - new Date(lastUpdate).getTime()) / 86400000;
    if (daysSince >= 7) {
        // Let the dashboard paint first; never block the first render.
        setTimeout(() => fetchPrices({ force: false }), 1500);
    }
};

// --- Rendering Helpers ---

const renderTransactionItem = (tx, asset) => {
    const isNegative = tx.type === 'sell';
    const amountColor = (tx.type === 'buy' || tx.type === 'update') ? 'var(--text-primary)' : 'var(--danger)';

    return `
        <div class="glass-panel flex-between list-item">
            <div style="flex: 1;">
                <div class="font-medium">${asset ? escapeHtml(asset.name) : 'Unknown Asset'}</div>
                <div class="text-sm text-muted">${new Date(tx.date).toLocaleDateString()}</div>
            </div>
            <div class="text-right mr-2">
                <div class="font-semibold" style="color: ${amountColor}">
                    ${isNegative ? '-' : ''}${formatCurrency(tx.amount)}
                </div>
            </div>
            <div class="flex-row gap-2">
                <button class="icon-btn js-edit-tx" data-id="${tx.id}" aria-label="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="icon-btn js-delete-tx" data-id="${tx.id}" aria-label="Delete" style="color: var(--danger);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `;
};

const getLastUpdated = (assetId) => {
    const txs = store.state.transactions.filter(t => t.assetId === assetId);
    if (!txs.length) return null;
    const latest = txs.reduce((best, t) => (t.date > best.date ? t : best), txs[0]);
    const date = new Date(latest.date);
    const today = new Date();
    const diffDays = Math.floor((today - date) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

const getPerformance = (asset) => {
    if (asset.category === 'Debt') return null;
    const costBasis = store.getAssetCostBasis(asset.id);
    if (costBasis <= 0) return null;
    const value = signedValue(asset);
    const gainLoss = value - costBasis;
    const pct = (gainLoss / costBasis) * 100;
    return { costBasis, gainLoss, pct };
};

const renderPerfBadge = (asset) => {
    const perf = getPerformance(asset);
    if (!perf) return '';
    const cls = perf.pct >= 0 ? 'positive' : 'negative';
    return `<div class="perf-badge ${cls}">${perf.pct >= 0 ? '+' : ''}${perf.pct.toFixed(1)}%</div>`;
};

const renderAssetCard = (asset) => {
    const value = signedValue(asset);
    const color = value < 0 ? 'var(--danger)' : 'var(--accent-primary)';
    const nativeCurrency = asset.currency && asset.currency !== 'EUR' && asset.quantity > 0
        ? `<div class="text-sm text-muted mt-1">${escapeHtml(asset.currency)} · ${Number(asset.quantity).toLocaleString()} units</div>`
        : asset.quantity > 0 ? `<div class="text-sm text-muted mt-1">${Number(asset.quantity).toLocaleString()} units</div>` : '';
    return `
        <div class="glass-panel asset-card-mini" data-asset-id="${asset.id}" style="cursor: pointer;">
            <div class="text-sm text-muted mb-2">${escapeHtml(asset.category)}</div>
            <div class="font-semibold mb-1" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(asset.name)}</div>
            <div class="font-medium" style="color: ${color}">${formatCurrency(value)}</div>
            ${nativeCurrency}
            ${renderPerfBadge(asset)}
        </div>
    `;
};

const renderAssetListItem = (asset) => {
    const value = signedValue(asset);
    const color = value < 0 ? 'var(--danger)' : 'var(--accent-primary)';
    const perf = getPerformance(asset);
    const lastUpd = getLastUpdated(asset.id);
    return `
        <div class="glass-panel flex-between list-item">
            <div style="flex: 1; min-width: 0; cursor: pointer;" class="js-open-detail" data-asset-id="${asset.id}">
                <div class="text-sm text-muted mb-2">${escapeHtml(asset.category)}</div>
                <div class="font-semibold" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(asset.name)}</div>
                ${lastUpd ? `<div style="font-size:0.65rem; color:var(--text-muted); margin-top:0.2rem;">${lastUpd}</div>` : ''}
            </div>
            <div class="text-right mr-2">
                <div class="font-medium" style="color: ${color}">${formatCurrency(value)}</div>
                ${asset.quantity > 0 ? `<div class="text-sm text-muted">${Number(asset.quantity).toLocaleString()} u</div>` : ''}
                ${perf ? `<div class="perf-badge ${perf.pct >= 0 ? 'positive' : 'negative'}" style="margin-top: 0.25rem;">${perf.pct >= 0 ? '+' : ''}${perf.pct.toFixed(1)}%</div>` : ''}
            </div>
            <div class="flex-row gap-2">
                <button class="icon-btn js-quick-update" data-id="${asset.id}" aria-label="Update value" title="Quick update value" style="color: var(--accent-primary);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                </button>
                <button class="icon-btn js-edit-asset" data-id="${asset.id}" aria-label="Edit asset">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="icon-btn js-delete-asset" data-id="${asset.id}" aria-label="Delete asset" style="color: var(--danger);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `;
};

// --- Validation Helpers ---

const showFieldError = (inputEl, message) => {
    inputEl.classList.add('input-error');
    const existing = inputEl.parentElement.querySelector('.field-error');
    if (existing) existing.remove();
    const err = document.createElement('p');
    err.className = 'field-error';
    err.textContent = message;
    inputEl.after(err);
};

const clearFieldErrors = (formEl) => {
    formEl.querySelectorAll('.field-error').forEach(e => e.remove());
    formEl.querySelectorAll('.input-error').forEach(e => e.classList.remove('input-error'));
};

const showTransactionError = (error) => {
    if (error?.code === 'insufficient-quantity') {
        showFieldError(
            document.getElementById('tx-quantity'),
            `Solo hay ${Number(error.available).toLocaleString('es-ES')} unidades disponibles`
        );
        return;
    }
    showToast('No se pudo guardar el movimiento', true);
};

const showToast = (message, isError = false, duration = 3000) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
};

// --- Navigation ---

const showView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
};

// --- UI Components ---

const updateTrendEl = (visibleAssets) => {
    const trendEl = document.getElementById('trend-value');
    const trendWrap = trendEl?.closest('.trend');
    if (!trendEl || !trendWrap) return;

    const visibleIds = visibleAssets.map(a => a.id);
    const anyFilter = hiddenCategories.size > 0 || hiddenAssetClasses.size > 0;
    const history = anyFilter
        ? store.getHistoryForAssets(visibleIds)
        : store.getHistory('all');

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const monthAgoStr = monthAgo.toISOString().split('T')[0];

    let prevTotal = 0;
    for (let i = 0; i < history.labels.length; i++) {
        if (history.labels[i] <= monthAgoStr) prevTotal = history.data[i];
    }

    const currTotal = visibleAssets.reduce((sum, a) => sum + signedValue(a), 0);
    if (prevTotal === 0) {
        trendEl.textContent = 'N/A';
        trendWrap.className = 'trend';
    } else {
        const pct = ((currTotal - prevTotal) / Math.abs(prevTotal)) * 100;
        trendEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        trendWrap.className = `trend ${pct >= 0 ? 'positive' : 'negative'}`;
    }
};

const renderDashboard = (state) => {
    const visibleAssets = state.assets.filter(isVisibleAsset);
    const visibleTotal = visibleAssets.reduce((sum, a) => sum + signedValue(a), 0);

    // Net Worth
    const totalEl = document.getElementById('total-net-worth');
    if (totalEl) totalEl.textContent = formatCurrency(visibleTotal);

    // Assets vs liabilities
    const breakdownEl = document.getElementById('assets-debt-breakdown');
    if (breakdownEl) {
        const debt = visibleAssets
            .filter(a => a.category === 'Debt')
            .reduce((sum, a) => sum + Math.abs(Number(a.currentValue) || 0), 0);
        if (debt > 0) {
            const gross = visibleTotal + debt;
            breakdownEl.textContent = `${formatCurrency(gross)} en activos · ${formatCurrency(debt)} en deudas`;
        } else {
            breakdownEl.textContent = '';
        }
    }

    // Goal progress
    const goalEl = document.getElementById('goal-progress');
    if (goalEl) {
        const target = Number(state.settings?.goalTarget) || 0;
        const monthly = Number(state.settings?.monthlyContribution) || 0;
        if (target > 0) {
            const pct = Math.max(0, Math.min(100, (visibleTotal / target) * 100));
            let eta = '';
            if (monthly > 0 && visibleTotal < target) {
                const months = Math.ceil((target - visibleTotal) / monthly);
                const date = new Date();
                date.setMonth(date.getMonth() + months);
                eta = ` · ${date.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })} a ${formatCurrency(monthly)}/mes`;
            } else if (visibleTotal >= target) {
                eta = ' · objetivo alcanzado';
            }
            goalEl.textContent = `Objetivo ${formatCurrency(target)} · ${pct.toFixed(0)}%${eta}`;
        } else {
            goalEl.textContent = '';
        }
    }

    // Portfolio gains summary (liabilities are excluded: they are not capital)
    const gainsEl = document.getElementById('portfolio-gains');
    if (gainsEl) {
        const investable = visibleAssets.filter(a => a.category !== 'Debt');
        const totalCostBasis = investable.reduce((sum, a) => sum + store.getAssetCostBasis(a.id), 0);
        if (totalCostBasis > 0) {
            const currentValue = investable.reduce((sum, a) => sum + signedValue(a), 0);
            const gain = currentValue - totalCostBasis;
            const pct = (gain / totalCostBasis) * 100;
            const color = gain >= 0 ? 'var(--success)' : 'var(--danger)';
            gainsEl.innerHTML = `<span style="color: var(--text-muted);">Invested ${formatCurrency(totalCostBasis)}</span><span style="color:${color}; margin-left:0.5rem; font-weight:600;">${gain >= 0 ? '+' : ''}${formatCurrency(gain)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`;
        } else {
            gainsEl.innerHTML = '';
        }
    }

    // Monthly trend
    updateTrendEl(visibleAssets);

    // Render Recent Transactions — always unfiltered
    const recentEl = document.getElementById('recent-transactions');
    if (recentEl) {
        if (state.transactions.length > 0) {
            recentEl.innerHTML = state.transactions.slice(0, 5).map(tx => {
                const asset = state.assets.find(a => a.id === tx.assetId);
                return renderTransactionItem(tx, asset);
            }).join('');
        } else {
            recentEl.innerHTML = `<div class="empty-state">No transactions yet</div>`;
        }
    }

    // Render Assets Preview — filtered by hiddenCategories
    const assetsEl = document.getElementById('assets-preview');
    if (assetsEl) {
        if (visibleAssets.length > 0) {
            assetsEl.innerHTML = visibleAssets.map(renderAssetCard).join('');
        } else if (state.assets.length > 0) {
            assetsEl.innerHTML = `
                <div class="glass-panel asset-card-mini flex-center text-muted" style="min-width: 200px;">
                    No visible assets
                </div>
            `;
        } else {
            assetsEl.innerHTML = `
                <div class="glass-panel asset-card-mini flex-center text-muted" style="min-width: 200px;">
                    Add your first asset
                </div>
            `;
        }
    }

    renderCategoryChips();
    renderAssetClassChips();
};

// --- Initialization ---

// DOM Elements
const modal = document.getElementById('modal-container');
const btnAdd = document.getElementById('fab-add');
const btnCloseModal = document.getElementById('close-modal');
const formTransaction = document.getElementById('form-transaction');
const formAsset = document.getElementById('form-asset');
const selectAsset = document.getElementById('tx-asset');
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const modalSettings = document.getElementById('modal-settings');
const btnCloseSettings = document.getElementById('close-settings');
const btnExport = document.getElementById('btn-export');
const btnImportTrigger = document.getElementById('btn-import-trigger');
const fileImport = document.getElementById('file-import');


// --- Helper Functions ---

// Accessible overlays: role/aria-modal, initial focus, focus restore and a
// shared Escape/Tab handler. The markup stays as-is; semantics are added here.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const overlayOrigins = new WeakMap();

const openOverlay = (el) => {
    if (!el) return;
    overlayOrigins.set(el, document.activeElement);
    el.classList.remove('hidden');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.classList.add('overlay-open');

    const title = el.querySelector('h2, h3');
    if (title) {
        if (!title.id) title.id = `overlay-title-${Math.random().toString(36).slice(2, 8)}`;
        el.setAttribute('aria-labelledby', title.id);
    } else {
        el.setAttribute('aria-label', el.id === 'modal-confirm' ? 'Confirm action' : 'Dialog');
    }

    requestAnimationFrame(() => {
        const target = el.querySelector(`[data-autofocus], ${FOCUSABLE}`);
        if (target) target.focus();
    });
};

const closeOverlay = (el) => {
    if (!el) return;
    el.classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
        document.body.classList.remove('overlay-open');
    }
    const origin = overlayOrigins.get(el);
    overlayOrigins.delete(el);
    if (origin && typeof origin.focus === 'function') origin.focus();
};

const openModal = () => {
    if (!modal) return;
    openOverlay(modal);
    // Default to today
    const dateInput = document.getElementById('tx-date');
    if (dateInput) dateInput.valueAsDate = new Date();

    const assetDateInput = document.getElementById('asset-date');
    if (assetDateInput) assetDateInput.valueAsDate = new Date();

    populateAssetSelect();

    // Reset form state properly
    const typeRadios = document.querySelectorAll('input[name="tx-type"]');
    typeRadios.forEach(r => {
        if (r.value === 'buy') r.checked = true;
    });
    handleTransactionTypeChange('buy');

    // If no assets, switch to asset tab automatically
    if (store.state.assets.length === 0) {
        switchTab('tab-asset');
    } else {
        switchTab('tab-transaction');
    }
    updateTickerVisibility();
};

const closeModal = () => {
    if (!modal) return;
    closeOverlay(modal);
    if (formTransaction) {
        formTransaction.reset();
        const btnSubmit = formTransaction.querySelector('button[type="submit"]');
        if (btnSubmit) btnSubmit.textContent = 'Save Transaction';
    }
    editingTransactionId = null;
    editingAssetId = null;
    if (formAsset) {
        formAsset.reset();
        ['asset-initial-value', 'asset-quantity', 'asset-date'].forEach(fId => {
            const el = document.getElementById(fId);
            if (el) el.closest('.form-group').classList.remove('hidden');
        });
        document.getElementById('group-ticker')?.classList.add('hidden');
        const btnSubmitAsset = formAsset.querySelector('button[type="submit"]');
        if (btnSubmitAsset) btnSubmitAsset.textContent = 'Create Asset';
    }
};

// --- Quick Update ---

let quickUpdateAssetId = null;

const openQuickUpdate = (assetId) => {
    const asset = store.state.assets.find(a => a.id === assetId);
    if (!asset) return;
    quickUpdateAssetId = assetId;
    document.getElementById('quick-update-title').textContent = asset.name;
    document.getElementById('quick-update-current').textContent = `Current: ${formatCurrency(signedValue(asset))}`;
    document.getElementById('quick-update-amount').value = '';
    document.getElementById('quick-update-date').valueAsDate = new Date();
    openOverlay(document.getElementById('quick-update-modal'));
    setTimeout(() => document.getElementById('quick-update-amount').focus(), 100);
};

const closeQuickUpdate = () => {
    closeOverlay(document.getElementById('quick-update-modal'));
    quickUpdateAssetId = null;
};

const openHelpModal  = () => openOverlay(document.getElementById('modal-help'));
const closeHelpModal = () => closeOverlay(document.getElementById('modal-help'));

const loadDemoData = () => {
    const proceed = () => {
        const result = store.importData(JSON.stringify(DEMO_DATA));
        if (result.success) {
            closeHelpModal();
            showToast('Portfolio de ejemplo cargado');
        } else {
            showToast('Error al cargar demo', true);
        }
    };
    if (store.state.assets.length > 0) {
        openConfirmModal('¿Reemplazar tus datos actuales con el portfolio de ejemplo?', proceed);
    } else {
        proceed();
    }
};

const clearAllData = () => {
    openConfirmModal('¿Borrar todos los datos de la app? Esta acción no se puede deshacer.', () => {
        store.importData(JSON.stringify({
            assets: [],
            transactions: [],
            settings: store.state.settings
        }));
        showToast('Datos borrados');
    });
};

const openSettings = () => {
    openOverlay(modalSettings);
    const avKeyEl = document.getElementById('av-api-key');
    if (avKeyEl) avKeyEl.value = store.state.settings?.alphaVantageKey || '';
    const avStatusEl = document.getElementById('av-key-status');
    if (avStatusEl) avStatusEl.textContent = '';
    const bulkStatusEl = document.getElementById('ticker-bulk-status');
    if (bulkStatusEl) bulkStatusEl.textContent = '';
    const goalTargetEl = document.getElementById('goal-target');
    if (goalTargetEl) goalTargetEl.value = store.state.settings?.goalTarget || '';
    const goalMonthlyEl = document.getElementById('goal-monthly');
    if (goalMonthlyEl) goalMonthlyEl.value = store.state.settings?.monthlyContribution || '';
    renderTickerBulkList();
};

const closeSettings = () => {
    closeOverlay(modalSettings);
};

const handleExport = () => {
    const json = store.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net-worth-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const result = store.importData(e.target.result);
        if (result.success) {
            showToast('Data imported successfully!');
            closeSettings();
        } else {
            showToast('Import failed: ' + result.error, true);
        }
    };
    reader.readAsText(file);
};


const switchTab = (tabId) => {
    tabs.forEach(t => {
        if (t.dataset.tab === tabId) t.classList.add('active');
        else t.classList.remove('active');
    });
    tabContents.forEach(c => {
        if (c.id === tabId) c.classList.remove('hidden');
        else c.classList.add('hidden');
    });
};

const populateAssetSelect = () => {
    if (!selectAsset) return;
    const assets = store.state.assets;
    const optionsHtml = ['<option value="" disabled selected>Select an asset</option>'];

    assets.forEach(asset => {
        optionsHtml.push(`<option value="${asset.id}">${escapeHtml(asset.name)} (${formatCurrency(signedValue(asset))})</option>`);
    });

    selectAsset.innerHTML = optionsHtml.join('');

    // Also populate From Asset select
    const selectFromAsset = document.getElementById('tx-from-asset');
    if (selectFromAsset) {
        selectFromAsset.innerHTML = ['<option value="" disabled selected>Select Source Asset</option>', ...optionsHtml.slice(1)].join('');
    }
};

const handleTransactionTypeChange = (type) => {
    const groupAsset = document.getElementById('group-asset');
    const groupFromAsset = document.getElementById('group-from-asset');
    const labelAsset = document.querySelector('label[for="tx-asset"]');
    const groupQuantity = document.getElementById('group-quantity');

    // Default visibility
    if (groupQuantity) groupQuantity.classList.remove('hidden');

    if (type === 'move') {
        groupFromAsset.classList.remove('hidden');
        if (labelAsset) labelAsset.textContent = 'To Asset';
        document.getElementById('tx-from-asset').required = true;
    } else if (type === 'update') {
        // Value updates might not need quantity unless explicitly creating a checkpoint
        // But let's keep it visible so users can update quantity count if needed
        groupFromAsset.classList.add('hidden');
        if (labelAsset) labelAsset.textContent = 'Asset';
        document.getElementById('tx-from-asset').required = false;
        // Optionally hide quantity for 'update' if it's confusing, but explicitly setting it is better.
        // Let's hide it for 'Value' update to keep it simple, assuming 'Value' is just for total amount.
        if (groupQuantity) groupQuantity.classList.add('hidden');
    } else {
        groupFromAsset.classList.add('hidden');
        if (labelAsset) labelAsset.textContent = 'Asset';
        document.getElementById('tx-from-asset').required = false;
    }
};

// --- Event Listeners ---

const setupEventListeners = () => {
    if (btnAdd) btnAdd.addEventListener('click', openModal);
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);

    // Close on backdrop click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    // Escape closes the topmost dialog; Tab is trapped inside it.
    document.addEventListener('keydown', (e) => {
        const open = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)')).pop();
        if (!open) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            const close = {
                'modal-confirm': closeConfirmModal,
                'quick-update-modal': closeQuickUpdate,
                'modal-settings': closeSettings,
                'modal-help': closeHelpModal,
                'modal-share': closeShareModal,
                'modal-container': closeModal,
            }[open.id];
            if (close) close();
            return;
        }

        if (e.key !== 'Tab') return;
        const nodes = Array.from(open.querySelectorAll(FOCUSABLE))
            .filter(node => node.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });

    // Help modal listeners
    document.getElementById('btn-help')?.addEventListener('click', openHelpModal);
    document.getElementById('close-help')?.addEventListener('click', closeHelpModal);
    document.getElementById('modal-help')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-help')) closeHelpModal();
    });
    document.getElementById('btn-load-demo')?.addEventListener('click', loadDemoData);
    document.getElementById('btn-clear-data')?.addEventListener('click', clearAllData);

    // Settings Listeners
    if (btnSettings) btnSettings.addEventListener('click', openSettings);
    if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
    if (modalSettings) {
        modalSettings.addEventListener('click', (e) => {
            if (e.target === modalSettings) closeSettings();
        });
    }
    if (btnExport) btnExport.addEventListener('click', handleExport);
    if (btnImportTrigger) {
        btnImportTrigger.addEventListener('click', () => {
            if (fileImport) fileImport.click();
        });
    }
    if (fileImport) fileImport.addEventListener('change', handleImport);

    // Theme toggle
    const btnThemeToggle = document.getElementById('theme-toggle');
    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const current = document.documentElement.dataset.theme || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            store.state.settings.theme = next;
            store.save();
        });
    }

    // Assets list view
    const btnViewAssets = document.querySelector('.js-view-assets');
    if (btnViewAssets) {
        btnViewAssets.addEventListener('click', () => {
            showView('assets-list-view');
            renderAllAssets(store.state);
        });
    }

    // Transactions view
    document.addEventListener('click', (e) => {
        if (e.target.closest('.js-view-transactions')) {
            populateTxFilterAsset();
            renderAllTransactions();
            showView('transactions-view');
        }
        if (e.target.closest('.js-back-to-dashboard') ||
            e.target.closest('#back-from-transactions') ||
            e.target.closest('#back-from-detail')) {
            showView('dashboard');
        }
    });

    // Transaction filter bar
    ['tx-filter-asset', 'tx-filter-type'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => renderAllTransactions());
    });
    document.getElementById('tx-filter-search')?.addEventListener('input', () => renderAllTransactions());

    // Asset detail — from dashboard cards
    document.getElementById('assets-preview')?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-asset-id]');
        if (card) openAssetDetail(card.dataset.assetId);
    });

    // Asset detail — from all-assets list (tap on name area)
    document.getElementById('all-assets-list')?.addEventListener('click', (e) => {
        const quickBtn = e.target.closest('.js-quick-update');
        if (quickBtn) { openQuickUpdate(quickBtn.dataset.id); return; }
        const item = e.target.closest('.js-open-detail');
        if (item) openAssetDetail(item.dataset.assetId);
    });

    // Quick update modal
    document.getElementById('close-quick-update')?.addEventListener('click', closeQuickUpdate);
    document.getElementById('quick-update-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeQuickUpdate();
    });
    document.getElementById('btn-quick-update-save')?.addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('quick-update-amount').value);
        const date = document.getElementById('quick-update-date').value;
        if (!quickUpdateAssetId || isNaN(amount) || !date) return;
        upsertUpdate(quickUpdateAssetId, date, amount, 'Manual update');
        closeQuickUpdate();
        showToast('Value updated');
    });

    // Asset detail — from all-transactions list
    document.getElementById('all-transactions-list')?.addEventListener('click', (e) => {
        const btnEdit = e.target.closest('.js-edit-tx');
        const btnDelete = e.target.closest('.js-delete-tx');
        if (btnEdit) openEditTransactionModal(btnEdit.dataset.id);
        else if (btnDelete) {
            const id = btnDelete.dataset.id;
            openConfirmModal('Delete this transaction?', () => {
                store.deleteTransaction(id);
                renderAllTransactions();
            });
        }
    });

    // Asset detail — transaction list inside detail view
    document.getElementById('detail-transactions-list')?.addEventListener('click', (e) => {
        const btnEdit = e.target.closest('.js-edit-tx');
        const btnDelete = e.target.closest('.js-delete-tx');
        if (btnEdit) openEditTransactionModal(btnEdit.dataset.id);
        else if (btnDelete) {
            const id = btnDelete.dataset.id;
            const tx = store.state.transactions.find(t => t.id === id);
            openConfirmModal('Delete this transaction?', () => {
                store.deleteTransaction(id);
                if (tx) openAssetDetail(tx.assetId); // refresh detail
            });
        }
    });

    // Transaction actions (delegated)
    const recentEl = document.getElementById('recent-transactions');
    if (recentEl) {
        recentEl.addEventListener('click', (e) => {
            const btnEdit = e.target.closest('.js-edit-tx');
            const btnDelete = e.target.closest('.js-delete-tx');
            if (btnEdit) {
                openEditTransactionModal(btnEdit.dataset.id);
            } else if (btnDelete) {
                const id = btnDelete.dataset.id;
                openConfirmModal('Delete this transaction?', () => store.deleteTransaction(id));
            }
        });
    }

    // Asset list actions (delegated)
    const allAssetsList = document.getElementById('all-assets-list');
    if (allAssetsList) {
        allAssetsList.addEventListener('click', (e) => {
            const btnEdit = e.target.closest('.js-edit-asset');
            const btnDelete = e.target.closest('.js-delete-asset');
            if (btnEdit) {
                openEditAssetModal(btnEdit.dataset.id);
            } else if (btnDelete) {
                const id = btnDelete.dataset.id;
                openConfirmModal('Delete this asset and all its transactions?', () => {
                    store.deleteAsset(id);
                    renderAllAssets(store.state);
                });
            }
        });
    }

    // Share modal
    document.getElementById('btn-share')?.addEventListener('click', openShareModal);
    document.getElementById('close-share')?.addEventListener('click', closeShareModal);
    document.getElementById('modal-share')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-share')) closeShareModal();
    });
    document.getElementById('btn-copy-share')?.addEventListener('click', async () => {
        const imageUrl = document.getElementById('modal-share').dataset.imageUrl;
        const text = document.getElementById('modal-share').dataset.shareText || '';
        if (imageUrl && navigator.clipboard?.write) {
            try {
                const blob = await fetch(imageUrl).then(r => r.blob());
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                showToast('Image copied!');
                return;
            } catch {}
        }
        navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
    });
    document.getElementById('btn-do-share')?.addEventListener('click', async () => {
        const imageUrl = document.getElementById('modal-share').dataset.imageUrl;
        const text = document.getElementById('modal-share').dataset.shareText || '';
        if (imageUrl && navigator.canShare) {
            try {
                const blob = await fetch(imageUrl).then(r => r.blob());
                const file = new File([blob], 'portfolio.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file], title: 'My Portfolio', text });
                    return;
                }
            } catch {}
        }
        if (navigator.share) {
            navigator.share({ title: 'My Portfolio', text }).catch(() => {});
        } else {
            navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
        }
    });

    // Category filter chips
    document.getElementById('category-filter-chips').addEventListener('click', (e) => {
        const chip = e.target.closest('.category-chip');
        if (!chip) return;
        const cat = chip.dataset.category;
        if (hiddenCategories.has(cat)) hiddenCategories.delete(cat);
        else hiddenCategories.add(cat);
        applyFilters();
    });

    // Asset class filter chips
    document.getElementById('asset-class-filter-chips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.category-chip[data-class]');
        if (!chip) return;
        const cls = chip.dataset.class;
        if (hiddenAssetClasses.has(cls)) hiddenAssetClasses.delete(cls);
        else hiddenAssetClasses.add(cls);
        applyFilters();
    });

    // Date range buttons
    document.querySelector('.date-range-btns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.date-range-btn');
        if (!btn) return;
        selectedDateRange = btn.dataset.range;
        document.querySelectorAll('.date-range-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateChart(document.getElementById('chart-filter').value);
    });

    // Refresh prices button
    document.getElementById('btn-refresh-prices')?.addEventListener('click', () => fetchPrices());

    // Save all tickers (bulk)
    document.getElementById('btn-save-all-tickers')?.addEventListener('click', saveAllTickers);
    document.getElementById('btn-apply-ticker-json')?.addEventListener('click', applyTickerJson);

    // Save Alpha Vantage key
    document.getElementById('btn-save-av-key')?.addEventListener('click', () => {
        const key = document.getElementById('av-api-key')?.value.trim() || '';
        store.editSettings({ alphaVantageKey: key });
        const statusEl = document.getElementById('av-key-status');
        if (statusEl) statusEl.textContent = key ? 'Key saved.' : 'Key cleared.';
    });

    // Save goal
    document.getElementById('btn-save-goal')?.addEventListener('click', () => {
        const target = Math.max(0, parseFloat(document.getElementById('goal-target')?.value) || 0);
        const monthly = Math.max(0, parseFloat(document.getElementById('goal-monthly')?.value) || 0);
        store.editSettings({ goalTarget: target, monthlyContribution: monthly });
        const statusEl = document.getElementById('goal-status');
        if (statusEl) statusEl.textContent = target > 0 ? 'Objetivo guardado.' : 'Objetivo borrado.';
    });

    // Ticker field visibility when category changes
    document.getElementById('asset-category')?.addEventListener('change', updateTickerVisibility);

    // Confirm modal
    document.getElementById('confirm-cancel').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-ok').addEventListener('click', () => {
        if (_confirmCallback) _confirmCallback();
        closeConfirmModal();
    });
    document.getElementById('modal-confirm').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-confirm')) closeConfirmModal();
    });

    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Transaction Type Change
    const txTypes = document.querySelectorAll('input[name="tx-type"]');
    txTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
            handleTransactionTypeChange(e.target.value);
        });
    });

    // Form: Create / Edit Asset
    if (formAsset) {
        formAsset.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('asset-name').value;
            const category = document.getElementById('asset-category').value;
            const currency = document.getElementById('asset-currency')?.value || 'EUR';
            const assetClass = document.getElementById('asset-class')?.value || '';

            const ticker = (document.getElementById('asset-ticker')?.value || '').trim();
            const tickerSource = ticker ? deriveSource(category) : '';

            if (editingAssetId) {
                store.editAsset(editingAssetId, { name, category, currency, assetClass, ticker, tickerSource });
                if (!document.getElementById('assets-list-view').classList.contains('hidden')) {
                    renderAllAssets(store.state);
                }
                closeModal();
                return;
            }

            const initialValue = parseFloat(document.getElementById('asset-initial-value').value) || 0;
            const initialQuantity = parseFloat(document.getElementById('asset-quantity').value) || 0;
            const dateInput = document.getElementById('asset-date');
            const date = dateInput && dateInput.value ? dateInput.value : new Date().toISOString();

            const newAsset = store.addAsset({ name, category, currency, assetClass, type: 'manual', ticker, tickerSource });

            try {
                if (initialValue > 0 || initialQuantity > 0) {
                    let amountEur = initialValue;
                    let txExtra = {};
                    if (currency !== 'EUR' && initialValue > 0) {
                        const rate = await fetchFxRate(currency, 'EUR');
                        amountEur = initialValue * rate;
                        txExtra = { originalAmount: initialValue, originalCurrency: currency, fxRate: rate };
                    }
                    store.addTransaction({
                        assetId: newAsset.id,
                        type: 'buy',
                        date,
                        amount: amountEur,
                        quantity: initialQuantity,
                        currentTotalValue: amountEur,
                        notes: 'Initial Balance',
                        ...txExtra
                    });
                }
            } catch (error) {
                showTransactionError(error);
            }

            closeModal();
        });
    }

    // Form: Create Transaction
    if (formTransaction) {
        formTransaction.addEventListener('submit', (e) => {
            e.preventDefault();
            clearFieldErrors(formTransaction);
            const assetId = selectAsset.value;
            const type = document.querySelector('input[name="tx-type"]:checked').value;
            const amount = parseFloat(document.getElementById('tx-amount').value);
            const quantity = parseFloat(document.getElementById('tx-quantity').value) || 0;
            const date = document.getElementById('tx-date').value;

            let fromAssetId = null;
            if (type === 'move') {
                fromAssetId = document.getElementById('tx-from-asset').value;
                if (!fromAssetId) {
                    showFieldError(document.getElementById('tx-from-asset'), 'Select a source asset');
                    return;
                }
                if (fromAssetId === assetId) {
                    showFieldError(document.getElementById('tx-asset'), 'Source and destination must be different');
                    return;
                }
            }

            if (!assetId) {
                showFieldError(document.getElementById('tx-asset'), 'Please select an asset');
                return;
            }


            try {
                if (editingTransactionId) {
                    const existingTx = store.state.transactions.find(t => t.id === editingTransactionId);
                    store.editTransaction(editingTransactionId, {
                        assetId,
                        type,
                        date,
                        amount,
                        quantity,
                        fromAssetId,
                        notes: existingTx?.notes || ''
                    });
                    editingTransactionId = null; // Reset
                } else {
                    store.addTransaction({
                        assetId,
                        type,
                        date,
                        amount,
                        quantity,
                        fromAssetId, // Only used if type is 'move'
                        notes: ''
                    });
                }
            } catch (error) {
                showTransactionError(error);
                return;
            }

            closeModal();
        });
    }

    // --- Google Drive Listeners ---
    document.getElementById('btn-auto-sync')?.addEventListener('click', async () => {
        if (isAutoSync()) {
            localStorage.removeItem(AUTOSYNC_KEY);
            clearStoredToken();
            updateDriveSyncUI();
            const statusEl = document.getElementById('drive-status');
            if (statusEl) statusEl.textContent = '';
            return;
        }
        const btn = document.getElementById('btn-auto-sync');
        const statusEl = document.getElementById('drive-status');
        btn.disabled = true;
        if (statusEl) { statusEl.className = 'drive-status'; statusEl.textContent = 'Conectando con Google…'; }
        try {
            await backupToDrive(store.state);
            localStorage.setItem(AUTOSYNC_KEY, '1');
            updateDriveSyncUI();
            if (statusEl) { statusEl.textContent = '✓ Sincronización activada'; statusEl.className = 'drive-status drive-success'; }
        } catch {
            if (statusEl) { statusEl.textContent = 'Error al conectar con Drive'; statusEl.className = 'drive-status drive-error'; }
        } finally { btn.disabled = false; }
    });

    document.getElementById('btn-drive-backup')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-drive-backup');
        const statusEl = document.getElementById('drive-status');
        btn.disabled = true;
        try {
            await backupToDrive(store.state);
            if (statusEl) { statusEl.textContent = `Guardado en Drive (${new Date().toLocaleString('es')})`; statusEl.className = 'drive-status drive-success'; }
        } catch {
            if (statusEl) { statusEl.textContent = 'Error al guardar en Drive'; statusEl.className = 'drive-status drive-error'; }
        } finally { btn.disabled = false; }
    });

    document.getElementById('btn-drive-restore')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-drive-restore');
        const statusEl = document.getElementById('drive-status');
        btn.disabled = true;
        try {
            const result = await restoreFromDrive();
            if (!result.success) {
                if (statusEl) { statusEl.textContent = 'No hay copia de seguridad en Drive'; statusEl.className = 'drive-status drive-error'; }
                return;
            }
            const confirmed = await showConfirm('¿Restaurar datos desde Drive? Se sobreescribirán los datos actuales.');
            if (!confirmed) return;
            const imported = store.importData(result.data);
            if (!imported.success) throw new Error(imported.error);
            if (statusEl) { statusEl.textContent = `Restaurado (${new Date(result.modifiedTime).toLocaleString('es')})`; statusEl.className = 'drive-status drive-success'; }
        } catch {
            if (statusEl) { statusEl.textContent = 'Error al restaurar desde Drive'; statusEl.className = 'drive-status drive-error'; }
        } finally { btn.disabled = false; }
    });
};

// --- Charting ---
let netWorthChart = null;

const initChart = () => {
    const ctx = document.getElementById('history-chart');
    if (!ctx) return;

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.05)';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const history = store.getHistory('all');

    netWorthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.labels,
            datasets: [{
                label: 'Value',
                data: history.data,
                borderColor: '#38bdf8',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
                    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
                    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHitRadius: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(30, 41, 59, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#38bdf8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            return formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 5 }
                },
                y: {
                    grid: { display: true },
                    ticks: {
                        callback: function (value) {
                            return new Intl.NumberFormat('en-US', { notation: "compact" }).format(value);
                        }
                    }
                }
            }
        }
    });
};

const updateChart = (filterId = 'all') => {
    if (!netWorthChart) return;

    let history;
    if (filterId === 'all') {
        const hasFilters = hiddenCategories.size > 0 || hiddenAssetClasses.size > 0;
        history = hasFilters
            ? store.getHistoryForAssets(getVisibleAssets().map(a => a.id))
            : store.getHistory('all');
    } else {
        history = store.getHistory(filterId);
    }
    const ranged = filterByRange(history.labels, history.data, selectedDateRange);
    netWorthChart.data.labels = ranged.labels;
    netWorthChart.data.datasets[0].data = ranged.data;
    netWorthChart.update();
};

const populateChartFilter = () => {
    const filterEl = document.getElementById('chart-filter');
    if (!filterEl) return;

    const assets = store.state.assets;
    const current = filterEl.value;

    const options = ['<option value="all">All Assets</option>'];
    assets.forEach(a => {
        options.push(`<option value="${a.id}">${escapeHtml(a.name)}</option>`);
    });

    filterEl.innerHTML = options.join('');
    filterEl.value = current;
};

// --- Confirm Modal ---
let _confirmCallback = null;
let _confirmReject = null;

const showConfirm = (message) => new Promise((resolve) => {
    openConfirmModal(message, () => resolve(true));
    _confirmReject = () => resolve(false);
});

const openConfirmModal = (message, onConfirm) => {
    document.getElementById('confirm-message').textContent = message;
    _confirmCallback = onConfirm;
    openOverlay(document.getElementById('modal-confirm'));
};

const closeConfirmModal = () => {
    closeOverlay(document.getElementById('modal-confirm'));
    if (_confirmReject) { _confirmReject(); _confirmReject = null; }
    _confirmCallback = null;
};

// --- Edit Logic ---
let editingTransactionId = null;
let editingAssetId = null;

const openEditAssetModal = (id) => {
    const asset = store.state.assets.find(a => a.id === id);
    if (!asset) return;
    editingAssetId = id;
    openModal();
    switchTab('tab-asset');
    document.getElementById('asset-name').value = asset.name;
    document.getElementById('asset-category').value = asset.category;
    const currEl = document.getElementById('asset-currency');
    if (currEl) currEl.value = asset.currency || 'EUR';
    const classEl = document.getElementById('asset-class');
    if (classEl) classEl.value = asset.assetClass || '';
    const tickerEl = document.getElementById('asset-ticker');
    if (tickerEl) tickerEl.value = asset.ticker || '';
    updateTickerVisibility();
    ['asset-initial-value', 'asset-quantity', 'asset-date'].forEach(fId => {
        const el = document.getElementById(fId);
        if (el) el.closest('.form-group').classList.add('hidden');
    });
    const btnSubmit = formAsset.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.textContent = 'Update Asset';
};

const openEditTransactionModal = (id) => {
    const tx = store.state.transactions.find(t => t.id === id);
    if (!tx) return;

    editingTransactionId = id;
    openModal();

    // Switch to transaction tab
    switchTab('tab-transaction');

    // Fill Form
    const selectAsset = document.getElementById('tx-asset');
    selectAsset.value = tx.assetId;

    // Set Radio
    const radio = document.querySelector(`input[name="tx-type"][value="${tx.type}"]`);
    if (radio) {
        radio.checked = true;
        handleTransactionTypeChange(tx.type);
    }

    document.getElementById('tx-amount').value = tx.amount;
    document.getElementById('tx-quantity').value = tx.quantity || 0;

    // Handle Date (extract YYYY-MM-DD)
    const dateStr = new Date(tx.date).toISOString().split('T')[0];
    document.getElementById('tx-date').value = dateStr;

    if (tx.type === 'move' && tx.fromAssetId) {
        const fromSelect = document.getElementById('tx-from-asset');
        if (fromSelect) fromSelect.value = tx.fromAssetId;
    }

    // Update Button Text
    const btnSubmit = formTransaction.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.textContent = 'Update Transaction';
};

// --- Category Treemap ---
const CATEGORY_COLORS = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c'];
let categoryChart = null;

const getTreemapData = (groupBy = 'category') => {
    const visibleAssets = getVisibleAssets().filter(a => signedValue(a) > 0);

    if (groupBy === 'asset') {
        return visibleAssets.map(a => ({ g: a.name, v: signedValue(a) }));
    }
    if (groupBy === 'assetClass') {
        return Object.entries(
            visibleAssets.reduce((acc, a) => {
                const key = a.assetClass || 'Sin clase';
                acc[key] = (acc[key] || 0) + signedValue(a);
                return acc;
            }, {})
        ).map(([g, v]) => ({ g, v }));
    }
    return Object.entries(
        visibleAssets.reduce((acc, a) => {
            acc[a.category] = (acc[a.category] || 0) + signedValue(a);
            return acc;
        }, {})
    ).map(([g, v]) => ({ g, v }));
};

const initCategoryChart = () => {
    const ctx = document.getElementById('category-chart');
    if (!ctx) return;
    const groupBy = document.getElementById('treemap-groupby')?.value || 'category';
    const treeData = getTreemapData(groupBy);
    categoryChart = new Chart(ctx, {
        type: 'treemap',
        data: {
            datasets: [{
                tree: treeData,
                key: 'v',
                groups: ['g'],
                borderWidth: 2,
                borderColor: 'var(--bg-body)',
                backgroundColor: (ctx) => {
                    if (ctx.type !== 'data') return 'transparent';
                    return CATEGORY_COLORS[ctx.dataIndex % CATEGORY_COLORS.length];
                },
                labels: {
                    display: true,
                    formatter: (ctx) => [ctx.raw._data.g, formatCurrency(ctx.raw.v)],
                    color: 'rgba(255,255,255,0.9)',
                    font: [
                        { weight: '600', size: 12, family: "'Outfit', sans-serif" },
                        { size: 11, family: "'Outfit', sans-serif" }
                    ]
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: () => '',
                        label: (ctx) => ` ${ctx.raw._data.g}: ${formatCurrency(ctx.raw.v)}`
                    }
                }
            }
        }
    });
    document.getElementById('category-chart-container').style.display = treeData.length ? '' : 'none';
};

const updateCategoryChart = () => {
    if (!categoryChart) return;
    const groupBy = document.getElementById('treemap-groupby')?.value || 'category';
    const treeData = getTreemapData(groupBy);
    categoryChart.data.datasets[0].tree = treeData;
    categoryChart.update();
    document.getElementById('category-chart-container').style.display = treeData.length ? '' : 'none';
};

// --- Category Filter Chips ---

const renderCategoryChips = () => {
    const container = document.getElementById('category-filter-chips');
    if (!container) return;
    const categories = [...new Set(store.state.assets.map(a => a.category))];
    if (categories.length < 2) { container.innerHTML = ''; return; }
    container.innerHTML =
        `<span class="filter-chips-label">Categoría</span>` +
        categories.map(cat => `
            <button class="category-chip ${hiddenCategories.has(cat) ? '' : 'active'}" data-category="${escapeHtml(cat)}">
                ${escapeHtml(cat)}
            </button>
        `).join('');
};

const renderAssetClassChips = () => {
    const container = document.getElementById('asset-class-filter-chips');
    if (!container) return;
    const classes = [...new Set(store.state.assets.map(a => a.assetClass).filter(Boolean))];
    if (classes.length < 2) { container.innerHTML = ''; return; }
    container.innerHTML =
        `<span class="filter-chips-label">Clase</span>` +
        classes.map(cls => `
            <button class="category-chip ${hiddenAssetClasses.has(cls) ? '' : 'active'}" data-class="${escapeHtml(cls)}">
                ${escapeHtml(cls)}
            </button>
        `).join('');
};

const applyFilters = () => {
    renderDashboard(store.state);
    updateChart(document.getElementById('chart-filter').value);
    updateCategoryChart();
};

// --- Share Modal ---

const openShareModal = () => {
    // Capture chart as image with percentage-only labels
    const canvas = document.getElementById('category-chart');
    let imageDataURL = null;

    if (canvas && categoryChart) {
        const dataset = categoryChart.data.datasets[0];
        const total = (dataset.tree || []).reduce((sum, d) => sum + d.v, 0);

        // Temporarily switch labels to percentages
        const originalFormatter = dataset.labels.formatter;
        dataset.labels = { ...dataset.labels, formatter: (ctx) => [
            ctx.raw._data.g,
            total > 0 ? `${(ctx.raw.v / total * 100).toFixed(1)}%` : '0%'
        ]};
        categoryChart.update('none');

        imageDataURL = canvas.toDataURL('image/png');

        // Restore original labels with currency amounts
        dataset.labels = { ...dataset.labels, formatter: originalFormatter };
        categoryChart.update('none');
    }

    const previewEl = document.getElementById('share-preview');
    if (previewEl) {
        previewEl.innerHTML = imageDataURL
            ? `<img src="${imageDataURL}" style="width: 100%; border-radius: var(--radius-md);">`
            : '';
    }

    // Text breakdown (fallback for sharing)
    const visibleAssets = getVisibleAssets().filter(a => signedValue(a) > 0);
    const total = visibleAssets.reduce((sum, a) => sum + signedValue(a), 0);

    const categories = {};
    visibleAssets.forEach(a => {
        categories[a.category] = (categories[a.category] || 0) + signedValue(a);
    });

    const breakdown = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, val]) => ({ cat, pct: total > 0 ? (val / total * 100) : 0 }));

    const shareText = `My portfolio breakdown:\n${breakdown.map(b => `• ${b.cat}: ${b.pct.toFixed(1)}%`).join('\n')}`;

    document.getElementById('share-content').innerHTML = breakdown.map(b => `
        <div class="flex-between mb-2">
            <span class="text-sm">${escapeHtml(b.cat)}</span>
            <span class="font-semibold" style="color: var(--accent-primary)">${b.pct.toFixed(1)}%</span>
        </div>`).join('');

    const modalEl = document.getElementById('modal-share');
    modalEl.dataset.shareText = shareText;
    modalEl.dataset.imageUrl = imageDataURL || '';
    openOverlay(modalEl);
};

const closeShareModal = () => closeOverlay(document.getElementById('modal-share'));

const renderAllAssets = (state) => {
    const container = document.getElementById('all-assets-list');
    if (!container) return;
    if (!state.assets.length) {
        container.innerHTML = '<div class="empty-state">No assets yet.</div>';
        return;
    }

    // Group by category
    const categoryOrder = ['Stocks', 'Funds', 'Crypto', 'Real Estate', 'Cash', 'Debt', 'Other'];
    const groups = {};
    state.assets.forEach(a => {
        const key = a.category || 'Other';
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
    });
    const sortedCategories = Object.keys(groups).sort((a, b) => {
        const ia = categoryOrder.indexOf(a);
        const ib = categoryOrder.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    let html = '';
    sortedCategories.forEach((category, idx) => {
        const assets = groups[category].sort((a, b) => signedValue(b) - signedValue(a));
        const subtotal = assets.reduce((sum, a) => sum + signedValue(a), 0);
        html += `<div class="list-group-header" style="${idx > 0 ? 'margin-top:1rem;' : ''}">
            <span>${escapeHtml(category)}</span>
            <span>${formatCurrency(subtotal)}</span>
        </div>`;
        html += assets.map(renderAssetListItem).join('');
    });

    container.innerHTML = html;
};

// --- Transactions View ---

const populateTxFilterAsset = () => {
    const sel = document.getElementById('tx-filter-asset');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Assets</option>' +
        store.state.assets.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    if (current) sel.value = current;
};

const getTxFilters = () => ({
    assetId: document.getElementById('tx-filter-asset')?.value || '',
    type: document.getElementById('tx-filter-type')?.value || '',
    search: document.getElementById('tx-filter-search')?.value || '',
});

const renderAllTransactions = () => {
    const container = document.getElementById('all-transactions-list');
    if (!container) return;
    const txs = store.filterTransactions(getTxFilters());
    container.innerHTML = txs.length
        ? txs.map(tx => renderTransactionItem(tx, store.state.assets.find(a => a.id === tx.assetId))).join('')
        : '<p class="text-muted text-sm" style="text-align:center;padding:2rem;">No transactions found.</p>';
};

// --- Asset Detail View ---

let detailChart = null;

const initDetailChart = (assetId) => {
    const ctx = document.getElementById('detail-chart');
    if (!ctx) return;
    const history = store.getHistory(assetId);
    if (detailChart) { detailChart.destroy(); detailChart = null; }
    if (!history.labels.length) return;
    detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.labels,
            datasets: [{
                data: history.data,
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56,189,248,0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => formatCurrency(ctx.raw) } }
            },
            scales: { x: { display: false }, y: { display: false } }
        }
    });
};

const openAssetDetail = (assetId) => {
    const asset = store.state.assets.find(a => a.id === assetId);
    if (!asset) return;

    document.getElementById('detail-asset-name').textContent = asset.name;
    document.getElementById('detail-asset-category').textContent = asset.category;
    document.getElementById('detail-asset-value').textContent = formatCurrency(signedValue(asset));

    const qtyEl = document.getElementById('detail-asset-quantity');
    qtyEl.textContent = asset.quantity > 0 ? `${Number(asset.quantity).toLocaleString()} units` : '';

    const perfEl = document.getElementById('detail-asset-perf');
    const perf = getPerformance(asset);
    if (perf) {
        const cls = perf.pct >= 0 ? 'positive' : 'negative';
        perfEl.innerHTML = `
            <span class="perf-badge ${cls}">${perf.pct >= 0 ? '+' : ''}${perf.pct.toFixed(1)}%</span>
            <span class="text-sm text-muted" style="margin-left:0.4rem;">vs ${formatCurrency(perf.costBasis)} invested</span>`;
    } else {
        perfEl.innerHTML = '';
    }

    const txs = store.state.transactions
        .filter(t => t.assetId === assetId)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('detail-transactions-list').innerHTML = txs.length
        ? txs.map(tx => renderTransactionItem(tx, asset)).join('')
        : '<p class="text-muted text-sm" style="text-align:center;padding:2rem;">No moves yet.</p>';

    initDetailChart(assetId);
    showView('asset-detail-view');
};

const init = () => {
    console.log('Initializing App...');

    // Surface storage failures instead of losing writes silently.
    store.onSaveError = () => showToast(
        'No se pudo guardar: el almacenamiento está lleno. Exportá una copia y liberá espacio.',
        true,
        8000
    );

    // Capture today's net worth even on a day with no edits.
    store.recordSnapshot();
    store.save();

    // Initial Render
    renderDashboard(store.state);
    populateChartFilter();
    initChart();
    initCategoryChart();

    // Subscribe to store updates
    store.subscribe((state) => {
        renderDashboard(state);
        populateChartFilter();
        const currentFilter = document.getElementById('chart-filter').value;
        updateChart(currentFilter);
        updateCategoryChart();
    });

    setupEventListeners();

    // --- Google Drive Sync ---
    const syncEl = document.getElementById('sync-indicator');
    onSyncStatus(status => {
        if (!syncEl) return;
        syncEl.className = 'sync-indicator visible ' + status;
        syncEl.textContent = status === 'syncing' ? '' : status === 'ok' ? '✓' : '✗';
        if (status !== 'syncing') setTimeout(() => syncEl.classList.remove('visible'), 3000);
    });

    const debouncedBackup = debounce(() => silentBackup(store.state), 3000);
    store.subscribe(() => { if (isAutoSync() && !isSyncing()) debouncedBackup(); });

    const startDrive = () => {
        initDrive();
        if (isAutoSync()) syncOnLoad(store.state, (data) => {
            store.importData(data);
        });
    };
    if (typeof google !== 'undefined' && google.accounts) {
        startDrive();
    } else {
        const iv = setInterval(() => {
            if (typeof google !== 'undefined' && google.accounts) {
                clearInterval(iv);
                startDrive();
            }
        }, 200);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && isAutoSync()) {
            debouncedBackup.flush();
        } else if (document.visibilityState === 'visible' && isAutoSync() && !isSyncing()) {
            syncOnLoad(store.state, (data) => { store.importData(data); });
        }
    });

    updateDriveSyncUI();

    // Chart Filter Listener
    const chartFilter = document.getElementById('chart-filter');
    if (chartFilter) {
        chartFilter.addEventListener('change', (e) => {
            updateChart(e.target.value);
        });
    }

    // Treemap groupby listener
    document.getElementById('treemap-groupby')?.addEventListener('change', () => updateCategoryChart());

    // Apply saved theme
    document.documentElement.dataset.theme = store.state.settings.theme || 'dark';

    // Auto-refresh prices if ≥7 days since last update
    scheduleAutoRefresh();

    console.log('App Initialized');
};

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        showToast('Nueva versión disponible. Recargá para actualizarla.', false, 6000);
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('SW registered:', registration);
            })
            .catch(error => {
                console.log('SW registration failed:', error);
            });
    });
}

document.addEventListener('DOMContentLoaded', init);
