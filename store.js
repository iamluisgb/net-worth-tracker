/**
 * Simple Pub/Sub Store for Net Worth Tracker
 * Handles localStorage persistence and state updates
 */

const STORAGE_KEY = 'net_worth_tracker_v1';

const defaultState = {
    assets: [], // { id, name, type, category, quantity, currentValue, ticker, tickerSource }
    transactions: [], // { id, assetId, type, date, amount, quantity, pricePerUnit }
    settings: {
        currency: 'EUR',
        theme: 'dark',
        alphaVantageKey: '',
        lastPriceUpdate: null
    }
};

class Store {
    constructor() {
        this.state = this.load();
        this.listeners = [];
    }

    load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return defaultState;
            const parsed = JSON.parse(stored);
            return {
                ...defaultState,
                ...parsed,
                settings: { ...defaultState.settings, ...parsed.settings }
            };
        } catch (e) {
            console.error('Failed to load state', e);
            return defaultState;
        }
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {
            console.error('Failed to save state', e);
        }
    }

    subscribe(listener) {
        this.listeners.push(listener);
        // Return unsubscribe function
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        this.listeners.forEach(listener => listener(this.state));
        this.save();
    }

    // --- Actions ---

    addAsset(asset) {
        // asset: { name, type, category }
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
        // transaction: { assetId, type, date, amount, quantity, pricePerUnit, fromAssetId, ... }

        if (transaction.type === 'move') {
            const { fromAssetId, assetId, amount, date, notes, quantity } = transaction;

            // Generate Sell for Source
            this.addTransaction({
                assetId: fromAssetId,
                type: 'sell',
                date,
                amount,
                quantity, // Pass quantity to sell
                notes: `Move to ${notes || 'another asset'}`
            });

            // Generate Buy for Destination
            this.addTransaction({
                assetId,
                type: 'buy',
                date,
                amount,
                quantity, // Pass quantity to buy
                notes: `Move from ${notes || 'another asset'}`
            });

            return; // Done
        }

        const newTransaction = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            ...transaction
        };

        this.state.transactions = [newTransaction, ...this.state.transactions];

        // Update asset state based on transaction
        this.updateAssetFromTransaction(newTransaction);

        this.notify();
    }

    updateAssetFromTransaction(tx) {
        const assetIndex = this.state.assets.findIndex(a => a.id === tx.assetId);
        if (assetIndex === -1) return;

        const asset = this.state.assets[assetIndex];
        let newQuantity = Number(asset.quantity);
        let newValue = Number(asset.currentValue);

        // Simple logic for now, can be expanded
        if (tx.type === 'buy') {
            newQuantity += Number(tx.quantity || 0);
            if (tx.currentTotalValue) {
                newValue = Number(tx.currentTotalValue);
            } else {
                newValue += Number(tx.amount);
            }
        } else if (tx.type === 'sell') {
            newQuantity -= Number(tx.quantity || 0);
            if (tx.currentTotalValue) {
                newValue = Number(tx.currentTotalValue);
            } else {
                newValue -= Number(tx.amount); // Rough estimate
            }
        } else if (tx.type === 'update') {
            // Just updating the current market value
            newValue = Number(tx.amount);
        }

        this.state.assets[assetIndex] = {
            ...asset,
            quantity: newQuantity,
            currentValue: newValue
        };
    }

    // --- Getters ---

    get totalNetWorth() {
        return this.state.assets.reduce((sum, asset) => sum + (asset.currentValue || 0), 0);
    }

    getHistory(filterAssetId = 'all') {
        // Sort transactions by date ASC
        const sortedTxs = [...this.state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        // We need to build a time series.
        // Map of date -> total value
        const timeline = new Map();

        // Track current value of assets as we replay history
        // assetId -> { quantity, value }
        const assetState = {};

        // Initialize assets
        this.state.assets.forEach(a => {
            assetState[a.id] = { quantity: 0, value: 0 };
        });

        sortedTxs.forEach(tx => {
            // If filtering, skip无关 transactions
            // For 'move', we have 2 transactions (buy and sell), handled separately in the loop

            const assetFn = assetState[tx.assetId];
            if (!assetFn) return; // Should not happen

            // Update state
            if (tx.type === 'buy') {
                assetFn.quantity += Number(tx.quantity || 0);
                if (tx.currentTotalValue) {
                    assetFn.value = Number(tx.currentTotalValue);
                } else {
                    assetFn.value += Number(tx.amount);
                }
            } else if (tx.type === 'sell') {
                assetFn.quantity -= Number(tx.quantity || 0);
                if (tx.currentTotalValue) {
                    assetFn.value = Number(tx.currentTotalValue);
                } else {
                    assetFn.value -= Number(tx.amount);
                }
            } else if (tx.type === 'update') {
                assetFn.value = Number(tx.amount);
            }

            // Calculate Total or Specific Value for this Date
            const dateStr = tx.date.split('T')[0];

            let dailyValue = 0;
            if (filterAssetId === 'all') {
                // Sum all assets
                dailyValue = Object.values(assetState).reduce((acc, curr) => acc + curr.value, 0);
            } else {
                // Return just the filtered asset
                dailyValue = assetState[filterAssetId] ? assetState[filterAssetId].value : 0;
            }

            timeline.set(dateStr, dailyValue);
        });

        // Add today's value if not present (ensures chart goes to today)
        const todayStr = new Date().toISOString().split('T')[0];
        if (!timeline.has(todayStr)) {
            let todayValue = 0;
            if (filterAssetId === 'all') {
                todayValue = this.totalNetWorth;
            } else {
                const a = this.state.assets.find(x => x.id === filterAssetId);
                todayValue = a ? a.currentValue : 0;
            }
            timeline.set(todayStr, todayValue);
        }

        return {
            labels: Array.from(timeline.keys()),
            data: Array.from(timeline.values())
        };
    }



    // --- Data Management ---

    exportData() {
        return JSON.stringify(this.state, null, 2);
    }

    importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);

            // Simple validation
            if (!data.assets || !Array.isArray(data.assets) || !data.transactions || !Array.isArray(data.transactions)) {
                throw new Error('Invalid data format');
            }

            // Restore state
            this.state = data;
            this.save();
            this.notify();
            return { success: true };
        } catch (e) {
            console.error('Import failed:', e);
            return { success: false, error: e.message };
        }
    }

    // --- State Recalculation ---

    recalculateState() {
        // Reset asset values to 0
        this.state.assets = this.state.assets.map(a => ({
            ...a,
            quantity: 0,
            currentValue: 0
        }));

        // Replay all transactions sorted by date
        const sortedTxs = [...this.state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        sortedTxs.forEach(tx => {
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

        this.state.assets[index] = { ...this.state.assets[index], ...updatedData };
        this.notify();
    }

    deleteAsset(id) {
        // Warning: This will orphan transactions if not handled. 
        // For simplicity, we just remove the asset. 
        // Ideal: Prevent delete if has transactions, or cascade delete.
        // Let's implement cascade delete for now to be "zero friction"
        this.state.assets = this.state.assets.filter(a => a.id !== id);
        this.state.transactions = this.state.transactions.filter(t => t.assetId !== id && t.fromAssetId !== id);
        this.notify();
    }

    getHistoryForAssets(assetIds) {
        const idSet = new Set(assetIds);
        const sortedTxs = [...this.state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
        const timeline = new Map();
        const assetState = {};
        this.state.assets.forEach(a => { assetState[a.id] = { quantity: 0, value: 0 }; });

        sortedTxs.forEach(tx => {
            const s = assetState[tx.assetId];
            if (!s) return;
            if (tx.type === 'buy') {
                s.quantity += Number(tx.quantity || 0);
                s.value = tx.currentTotalValue ? Number(tx.currentTotalValue) : s.value + Number(tx.amount);
            } else if (tx.type === 'sell') {
                s.quantity -= Number(tx.quantity || 0);
                s.value = tx.currentTotalValue ? Number(tx.currentTotalValue) : s.value - Number(tx.amount);
            } else if (tx.type === 'update') {
                s.value = Number(tx.amount);
            }
            const dateStr = tx.date.split('T')[0];
            const daily = this.state.assets
                .filter(a => idSet.has(a.id))
                .reduce((acc, a) => acc + (assetState[a.id]?.value || 0), 0);
            timeline.set(dateStr, daily);
        });

        const todayStr = new Date().toISOString().split('T')[0];
        if (!timeline.has(todayStr)) {
            const todayVal = this.state.assets
                .filter(a => idSet.has(a.id))
                .reduce((acc, a) => acc + (a.currentValue || 0), 0);
            timeline.set(todayStr, todayVal);
        }
        return { labels: Array.from(timeline.keys()), data: Array.from(timeline.values()) };
    }

    getAssetCostBasis(assetId) {
        const txs = this.state.transactions.filter(t => t.assetId === assetId);
        const invested = txs.filter(t => t.type === 'buy')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const received = txs.filter(t => t.type === 'sell')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        return invested - received;
    }

    filterTransactions({ assetId = '', type = '', search = '' } = {}) {
        return [...this.state.transactions]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .filter(tx => {
                if (assetId && tx.assetId !== assetId) return false;
                if (type && tx.type !== type) return false;
                if (search && !(tx.notes || '').toLowerCase().includes(search.toLowerCase())) return false;
                return true;
            });
    }

    get validAssets() {
        return this.state.assets.filter(a => a.currentValue > 0 || a.quantity > 0);
    }
}

export const store = new Store();
