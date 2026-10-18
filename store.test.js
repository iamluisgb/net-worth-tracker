import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const memoryStorage = () => {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        clear: () => data.clear(),
    };
};

// Node 20+ exposes `crypto` as a getter-only global, so plain assignment
// throws there. defineProperty works on every supported version.
Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
});
let uuid = 0;
Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `id-${++uuid}` },
    configurable: true,
    writable: true,
});

const { Store } = await import('./store.js');

let store;

const addCash = (amount, date = '2025-01-01') => {
    const asset = store.addAsset({ name: 'Cash', category: 'Cash' });
    store.addTransaction({ assetId: asset.id, type: 'buy', date, amount, quantity: 0 });
    return asset;
};

beforeEach(() => {
    globalThis.localStorage = memoryStorage();
    store = new Store(globalThis.localStorage);
});

test('same-day update is replayed after the buy that precedes it', () => {
    const asset = store.addAsset({ name: 'Broker', category: 'Stocks' });
    store.addTransaction({ assetId: asset.id, type: 'buy', date: '2025-03-01', amount: 1000, quantity: 10 });
    store.addTransaction({ assetId: asset.id, type: 'update', date: '2025-03-01', amount: 1200 });

    const history = store.getHistory('all');
    const point = history.data[history.labels.indexOf('2025-03-01')];
    assert.equal(point, 1200);
});

test('legacy same-day rows without timestamps still replay in insertion order', () => {
    const asset = store.addAsset({ name: 'Legacy', category: 'Stocks' });
    store.state.transactions = [
        { id: 'tx-update', assetId: asset.id, type: 'update', date: '2025-04-01', amount: 1200 },
        { id: 'tx-buy', assetId: asset.id, type: 'buy', date: '2025-04-01', amount: 1000, quantity: 10 },
    ];
    store.recalculateState();

    const history = store.getHistory('all');
    assert.equal(history.data[history.labels.indexOf('2025-04-01')], 1200);
});

test('selling more units than owned is rejected and leaves state untouched', () => {
    const asset = store.addAsset({ name: 'ETF', category: 'Funds' });
    store.addTransaction({ assetId: asset.id, type: 'buy', date: '2025-02-01', amount: 1000, quantity: 10 });

    assert.throws(
        () => store.addTransaction({ assetId: asset.id, type: 'sell', date: '2025-02-02', amount: 2000, quantity: 11 }),
        (error) => error.code === 'insufficient-quantity' && error.available === 10
    );
    assert.equal(store.state.assets[0].quantity, 10);
    assert.equal(store.state.transactions.length, 1);
});

test('moving more units than the source owns is rejected', () => {
    const source = store.addAsset({ name: 'Source', category: 'Crypto' });
    const destination = store.addAsset({ name: 'Destination', category: 'Crypto' });
    store.addTransaction({ assetId: source.id, type: 'buy', date: '2025-02-01', amount: 500, quantity: 2 });

    assert.throws(
        () => store.addTransaction({
            assetId: destination.id,
            fromAssetId: source.id,
            type: 'move',
            date: '2025-02-02',
            amount: 500,
            quantity: 3,
        }),
        (error) => error.code === 'insufficient-quantity'
    );
    assert.equal(store.state.transactions.length, 1);
});

test('cost basis keeps the proportional half after a partial sale', () => {
    const asset = store.addAsset({ name: 'Stock', category: 'Stocks' });
    store.addTransaction({ assetId: asset.id, type: 'buy', date: '2025-01-01', amount: 1000, quantity: 10 });
    store.addTransaction({ assetId: asset.id, type: 'sell', date: '2025-02-01', amount: 800, quantity: 5 });

    assert.equal(store.getAssetCostBasis(asset.id), 500);
});

test('cost basis without units falls back to net contributions', () => {
    const asset = addCash(1000);
    store.addTransaction({ assetId: asset.id, type: 'sell', date: '2025-02-01', amount: 400, quantity: 0 });

    assert.equal(store.getAssetCostBasis(asset.id), 600);
});

test('a debt asset always reduces net worth', () => {
    store.addAsset({ name: 'Mortgage', category: 'Debt', currentValue: 200000 });
    addCash(50000);

    assert.equal(store.totalNetWorth, -150000);
});

test('today is recorded as a snapshot and kept up to date', () => {
    const asset = addCash(1000);
    const today = store.getHistory('all').labels.at(-1);
    const history = store.getHistory('all');
    assert.equal(history.data[history.labels.indexOf(today)], 1000);

    store.addTransaction({ assetId: asset.id, type: 'update', date: today, amount: 1500 });
    const updated = store.getHistory('all');
    assert.equal(updated.data[updated.labels.indexOf(today)], 1500);
    assert.equal(store.state.snapshots[today], 1500);
});

test('import recalculates values and keeps settings defaults', () => {
    const result = store.importData(JSON.stringify({
        assets: [{ id: 'a1', name: 'Imported', category: 'Cash', currentValue: 999, quantity: 0 }],
        transactions: [{ id: 't1', assetId: 'a1', type: 'buy', date: '2025-05-01', amount: 250, quantity: 0 }],
    }));

    assert.equal(result.success, true);
    assert.equal(store.state.assets[0].currentValue, 250);
    assert.equal(store.state.settings.theme, 'dark');
    assert.equal(store.state.settings.alphaVantageKey, '');
});

test('import rejects payloads without assets and transactions', () => {
    const result = store.importData(JSON.stringify({ assets: 'nope' }));
    assert.equal(result.success, false);
    assert.match(result.error, /Invalid data format/);
});

test('move transactions show up under the move filter', () => {
    const source = store.addAsset({ name: 'Broker A', category: 'Stocks' });
    const destination = store.addAsset({ name: 'Broker B', category: 'Stocks' });
    store.addTransaction({ assetId: source.id, type: 'buy', date: '2025-01-01', amount: 500, quantity: 5 });
    store.addTransaction({
        assetId: destination.id,
        fromAssetId: source.id,
        type: 'move',
        date: '2025-01-02',
        amount: 500,
        quantity: 5,
    });

    const moves = store.filterTransactions({ type: 'move' });
    assert.equal(moves.length, 2);
    assert.equal(store.state.assets.find(a => a.id === source.id).quantity, 0);
    assert.equal(store.state.assets.find(a => a.id === destination.id).quantity, 5);
});

test('batch notifies once and records the final snapshot', () => {
    const asset = addCash(100);
    let calls = 0;
    store.subscribe(() => { calls++; });

    store.batch(() => {
        store.addTransaction({ assetId: asset.id, type: 'update', date: '2025-01-02', amount: 200 });
        store.addTransaction({ assetId: asset.id, type: 'update', date: '2025-01-03', amount: 300 });
    });

    assert.equal(calls, 1);
    assert.equal(store.state.assets[0].currentValue, 300);
});

test('a full localStorage reports through onSaveError instead of failing silently', () => {
    const failing = memoryStorage();
    failing.setItem = () => { throw new Error('QuotaExceededError'); };
    const failingStore = new Store(failing);
    let reported = 0;
    failingStore.onSaveError = () => { reported++; };

    assert.equal(failingStore.save(), false);
    assert.equal(reported, 1);
});

test('export never includes the Alpha Vantage key', () => {
    store.editSettings({ alphaVantageKey: 'super-secret' });
    const exported = store.exportData();
    assert.equal(exported.includes('super-secret'), false);
    assert.equal(JSON.parse(exported).settings.alphaVantageKey, undefined);
});
