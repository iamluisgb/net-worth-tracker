/**
 * Simple Pub/Sub Store for My Worth Tracker
 * Handles localStorage persistence and state updates.
 *
 * All monetary values are stored in EUR. Dates are stored as local
 * `YYYY-MM-DD` keys, never as timestamps, so a portfolio does not shift a day
 * when the device changes timezone.
 */

const STORAGE_KEY = 'net_worth_tracker_v1';

const defaultState = () => ({
    assets: [], // { id, name, type, category, assetClass, currency, quantity, currentValue, ticker, tickerSource }
    transactions: [], // { id, assetId, type, date, amount, quantity, pricePerUnit, timestamp }
    snapshots: {}, // { 'YYYY-MM-DD': totalNetWorth } — recorded on every change
    settings: {
        currency: 'EUR',
        theme: 'dark',
        alphaVantageKey: '',
        lastPriceUpdate: null,
        priceCache: {},
        goalTarget: 0,
        monthlyContribution: 0
    }
});

const pad = (n) => String(n).padStart(2, '0');

/** Local (not UTC) date key, so "today" means today on the user's device. */
export const localDateKey = (value = new Date()) => {
    if (value instanceof Date) {
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
};

/** Debts always reduce net worth, however the user typed the amount. */
export const signedValue = (asset) => {
    const value = Number(asset?.currentValue) || 0;
    return asset?.category === 'Debt' ? -Math.abs(value) : value;
};

class Store {
    constructor(storage = globalThis.localStorage) {
        this.storage = storage;
        this.state = this.load();
        this.listeners = [];
        this.onSaveError = null;
        this._batchDepth = 0;
    }

    load() {
        const base = defaultState();
        try {
            const stored = this.storage?.getItem(STORAGE_KEY);
            if (!stored) return base;
            const parsed = JSON.parse(stored);
            return {
                ...base,
                ...parsed,
                assets: Array.isArray(parsed.assets) ? parsed.assets : [],
                transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
                snapshots: parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {},
                settings: { ...base.settings, ...(parsed.settings || {}) }
            };
        } catch (e) {
            console.error('Failed to load state', e);
            return base;
        }
    }

    save() {
        try {
            this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
            return true;
        } catch (e) {
            console.error('Failed to save state', e);
            if (this.onSaveError) this.onSaveError(e);
            return false;
        }
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        if (this._batchDepth > 0) return;
        this.recordSnapshot();
        this.listeners.forEach(listener => listener(this.state));
        this.save();
    }

    /**
     * Run a synchronous block and notify once at the end instead of after every
     * mutation. Used by the price refresh, which can touch dozens of assets.
     */
    batch(fn) {
        this._batchDepth += 1;
        try {
            return fn();
        } finally {
            this._batchDepth -= 1;
            if (this._batchDepth === 0) this.notify();
        }
    }

    // --- Ordering ---

    /**
     * Transactions in replay order.
     *
     * Sorting by date alone is not enough: `addTransaction` prepends, so with
     * legacy data (no `timestamp`) the array is newest-first and a same-day
     * update would be replayed before the buy it follows. Tie-break on the
     * insertion timestamp, then on array position reversed.
     */
    chronological() {
        const total = this.state.transactions.length;
        return this.state.transactions
            .map((tx, index) => ({ tx, index }))
            .sort((a, b) => {
                const dateA = localDateKey(a.tx.date);
                const dateB = localDateKey(b.tx.date);
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                const timeA = Number(a.tx.timestamp) || 0;
                const timeB = Number(b.tx.timestamp) || 0;
                if (timeA !== timeB) return timeA - timeB;
                return b.index - a.index;
            })
            .map(({ tx }) => tx);
    }

    // --- Actions ---

    addAsset(asset) {
        const newAsset = {
            id: crypto.randomUUID(),
            currentValue: 0,
            quantity: 0,
            ...asset
        };
        this.state.assets = [...this.state.assets, newAsset];
        this.notify();
        return newAsset;
    }

    addTransaction(transaction) {
        const date = localDateKey(transaction.date);
        if (!date) throw new Error('invalid-date');

        if (transaction.type === 'move') {
            const { fromAssetId, assetId, amount, notes, quantity } = transaction;
            const source = this.state.assets.find(a => a.id === fromAssetId);
            const destination = this.state.assets.find(a => a.id === assetId);
            if (!source || !destination) throw new Error('unknown-asset');
            if (fromAssetId === assetId) throw new Error('same-asset');

            const moved = Number(quantity) || 0;
            if (moved > 0 && moved > (Number(source.quantity) || 0) + 1e-9) {
                const error = new Error('insufficient-quantity');
                error.code = 'insufficient-quantity';
                error.available = Number(source.quantity) || 0;
                error.assetName = source.name;
                throw error;
            }

            this.addTransaction({
                assetId: fromAssetId,
                type: 'sell',
                date,
                amount,
                quantity: moved,
                notes: `Move to ${destination.name}`
            });
            this.addTransaction({
                assetId,
                type: 'buy',
                date,
                amount,
                quantity: moved,
                notes: `Move from ${source.name}`
            });
            return;
        }

        const asset = this.state.assets.find(a => a.id === transaction.assetId);
        if (!asset) throw new Error('unknown-asset');

        const quantity = Number(transaction.quantity) || 0;
        if (transaction.type === 'sell' && quantity > 0) {
            const owned = Number(asset.quantity) || 0;
            if (quantity > owned + 1e-9) {
                const error = new Error('insufficient-quantity');
                error.code = 'insufficient-quantity';
                error.available = owned;
                error.assetName = asset.name;
                throw error;
            }
        }

        const newTransaction = {
            id: crypto.randomUUID(),
            ...transaction,
            date,
            quantity,
            timestamp: Number(transaction.timestamp) || Date.now()
        };

        this.state.transactions = [newTransaction, ...this.state.transactions];
        this.updateAssetFromTransaction(newTransaction);
        this.notify();
        return newTransaction;
    }

    updateAssetFromTransaction(tx) {
        const assetIndex = this.state.assets.findIndex(a => a.id === tx.assetId);
        if (assetIndex === -1) return;

        const asset = this.state.assets[assetIndex];
        const hasTotal = tx.currentTotalValue !== undefined && tx.currentTotalValue !== null && tx.currentTotalValue !== '';
        let newQuantity = Number(asset.quantity) || 0;
        let newValue = Number(asset.currentValue) || 0;

        if (tx.type === 'buy') {
            newQuantity += Number(tx.quantity) || 0;
            newValue = hasTotal ? Number(tx.currentTotalValue) : newValue + (Number(tx.amount) || 0);
        } else if (tx.type === 'sell') {
            newQuantity -= Number(tx.quantity) || 0;
            newValue = hasTotal ? Number(tx.currentTotalValue) : newValue - (Number(tx.amount) || 0);
        } else if (tx.type === 'update') {
            newValue = Number(tx.amount) || 0;
        }

        this.state.assets[assetIndex] = {
            ...asset,
            quantity: newQuantity,
            currentValue: newValue
        };
    }

    // --- Getters ---

    get totalNetWorth() {
        return this.state.assets.reduce((sum, asset) => sum + signedValue(asset), 0);
    }

    /**
     * Replay the ledger into a date -> value map.
     * `assetIds === null` means every asset. Snapshots are not applied here.
     */
    buildTimeline(assetIds = null) {
        const selected = assetIds ? new Set(assetIds) : null;
        const assetState = {};
        this.state.assets.forEach(a => { assetState[a.id] = { quantity: 0, value: 0 }; });

        const timeline = new Map();

        this.chronological().forEach(tx => {
            const current = assetState[tx.assetId];
            if (!current) return;

            const hasTotal = tx.currentTotalValue !== undefined && tx.currentTotalValue !== null && tx.currentTotalValue !== '';
            if (tx.type === 'buy') {
                current.quantity += Number(tx.quantity) || 0;
                current.value = hasTotal ? Number(tx.currentTotalValue) : current.value + (Number(tx.amount) || 0);
            } else if (tx.type === 'sell') {
                current.quantity -= Number(tx.quantity) || 0;
                current.value = hasTotal ? Number(tx.currentTotalValue) : current.value - (Number(tx.amount) || 0);
            } else if (tx.type === 'update') {
                current.value = Number(tx.amount) || 0;
            }

            const dateStr = localDateKey(tx.date);
            let daily = 0;
            this.state.assets.forEach(a => {
                if (selected && !selected.has(a.id)) return;
                const state = assetState[a.id];
                daily += a.category === 'Debt' ? -Math.abs(state.value) : state.value;
            });
            timeline.set(dateStr, daily);
        });

        return timeline;
    }

    getHistory(filterAssetId = 'all') {
        const timeline = this.buildTimeline(filterAssetId === 'all' ? null : [filterAssetId]);

        // Recorded snapshots are what actually happened; they also cover days
        // with no transaction, which the ledger alone cannot do.
        if (filterAssetId === 'all') {
            Object.entries(this.state.snapshots || {}).forEach(([date, value]) => {
                const amount = Number(value);
                if (Number.isFinite(amount)) timeline.set(date, amount);
            });
        }

        const today = localDateKey();
        if (filterAssetId === 'all') {
            timeline.set(today, this.totalNetWorth);
        } else {
            const asset = this.state.assets.find(a => a.id === filterAssetId);
            timeline.set(today, asset ? signedValue(asset) : 0);
        }

        const labels = Array.from(timeline.keys()).sort();
        return { labels, data: labels.map(date => timeline.get(date)) };
    }

    getHistoryForAssets(assetIds) {
        const timeline = this.buildTimeline(assetIds);
        const today = localDateKey();
        const selected = new Set(assetIds);
        const todayValue = this.state.assets
            .filter(a => selected.has(a.id))
            .reduce((sum, a) => sum + signedValue(a), 0);
        timeline.set(today, todayValue);
        const labels = Array.from(timeline.keys()).sort();
        return { labels, data: labels.map(date => timeline.get(date)) };
    }

    /** Record today's net worth once per session change. */
    recordSnapshot() {
        if (!this.state.assets.length) return;
        const today = localDateKey();
        const total = this.totalNetWorth;
        const previous = Number(this.state.snapshots?.[today]);
        if (!Number.isFinite(previous) || Math.abs(previous - total) > 0.005) {
            this.state.snapshots = { ...(this.state.snapshots || {}), [today]: total };
        }
    }

    // --- Data Management ---

    exportData() {
        // Never leak the Alpha Vantage key into a file the user may share.
        const safeSettings = { ...(this.state.settings || {}) };
        delete safeSettings.alphaVantageKey;
        return JSON.stringify({ ...this.state, settings: safeSettings }, null, 2);
    }

    importData(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;

            if (!data || !Array.isArray(data.assets) || !Array.isArray(data.transactions)) {
                throw new Error('Invalid data format');
            }

            const base = defaultState();
            this.state = {
                ...base,
                ...data,
                assets: data.assets.map(asset => ({
                    ...asset,
                    quantity: Number(asset.quantity) || 0,
                    currentValue: Number(asset.currentValue) || 0
                })),
                transactions: data.transactions.map(tx => ({
                    ...tx,
                    date: localDateKey(tx.date),
                    amount: Number(tx.amount) || 0,
                    quantity: Number(tx.quantity) || 0
                })),
                snapshots: data.snapshots && typeof data.snapshots === 'object' ? data.snapshots : {},
                settings: { ...base.settings, ...(data.settings || {}) }
            };

            this.recalculateState();
            return { success: true };
        } catch (e) {
            console.error('Import failed:', e);
            return { success: false, error: e.message };
        }
    }

    // --- State Recalculation ---

    recalculateState() {
        this.state.assets = this.state.assets.map(a => ({
            ...a,
            quantity: 0,
            currentValue: 0
        }));

        this.chronological().forEach(tx => {
            this.updateAssetFromTransaction(tx);
        });

        this.notify();
    }

    // --- Edit / Delete Actions ---

    editTransaction(id, updatedData) {
        const index = this.state.transactions.findIndex(t => t.id === id);
        if (index === -1) return;

        const existing = this.state.transactions[index];
        const merged = { ...existing, ...updatedData };
        if (updatedData.date) merged.date = localDateKey(updatedData.date);

        // Keep currentTotalValue in sync with amount so recalculateState uses the new value
        if (existing.currentTotalValue !== undefined && updatedData.amount !== undefined) {
            merged.currentTotalValue = updatedData.amount;
        }

        this.state.transactions[index] = merged;
        this.recalculateState();
    }

    deleteTransaction(id) {
        this.state.transactions = this.state.transactions.filter(t => t.id !== id);
        this.recalculateState();
    }

    editSettings(updates) {
        this.state.settings = { ...this.state.settings, ...updates };
        this.notify();
    }

    editAsset(id, updatedData) {
        const index = this.state.assets.findIndex(a => a.id === id);
        if (index === -1) return;

        const clean = { ...updatedData };
        if (clean.quantity !== undefined) clean.quantity = Number(clean.quantity) || 0;
        if (clean.currentValue !== undefined) clean.currentValue = Number(clean.currentValue) || 0;

        this.state.assets[index] = { ...this.state.assets[index], ...clean };
        this.notify();
    }

    deleteAsset(id) {
        // Cascade delete: an asset without its ledger would leave orphan
        // transactions behind.
        this.state.assets = this.state.assets.filter(a => a.id !== id);
        this.state.transactions = this.state.transactions.filter(t => t.assetId !== id && t.fromAssetId !== id);
        this.notify();
    }

    /**
     * Remaining cost basis.
     *
     * Assets with units use average cost, so selling half the position keeps
     * half the basis. Assets without units (cash, property, debt) fall back to
     * net contributions.
     */
    getAssetCostBasis(assetId) {
        const txs = this.chronological().filter(t => t.assetId === assetId);
        const hasQuantities = txs.some(t => Number(t.quantity) > 0);

        if (!hasQuantities) {
            const invested = txs.filter(t => t.type === 'buy')
                .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
            const received = txs.filter(t => t.type === 'sell')
                .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
            return Math.max(0, invested - received);
        }

        let quantity = 0;
        let basis = 0;
        txs.forEach(tx => {
            const moved = Number(tx.quantity) || 0;
            const amount = Number(tx.amount) || 0;
            if (tx.type === 'buy') {
                quantity += moved;
                basis += amount;
            } else if (tx.type === 'sell') {
                if (moved > 0 && quantity > 0) {
                    const sold = Math.min(moved, quantity);
                    basis -= basis * (sold / quantity);
                    quantity -= sold;
                } else {
                    basis = Math.max(0, basis - amount);
                }
            }
        });
        return Math.max(0, basis);
    }

    filterTransactions({ assetId = '', type = '', search = '' } = {}) {
        return [...this.state.transactions]
            .sort((a, b) => {
                const dateA = localDateKey(a.date);
                const dateB = localDateKey(b.date);
                if (dateA !== dateB) return dateA < dateB ? 1 : -1;
                return (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0);
            })
            .filter(tx => {
                if (assetId && tx.assetId !== assetId) return false;
                if (type === 'move') {
                    // Moves are persisted as a sell + a buy pair; match the notes.
                    if (!/^Move (to|from) /.test(tx.notes || '')) return false;
                } else if (type && tx.type !== type) {
                    return false;
                }
                if (search && !(tx.notes || '').toLowerCase().includes(search.toLowerCase())) return false;
                return true;
            });
    }

    get validAssets() {
        return this.state.assets.filter(a => a.currentValue > 0 || a.quantity > 0);
    }
}

export { Store };
export const store = new Store();
