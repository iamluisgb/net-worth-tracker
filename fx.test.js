// Run with `node --test` (Node >= 18.19). package.json sets "type": "module"
// so plain .js files load as ESM on every supported Node version.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, fetchFxRate, resetFxCache } from './fx.js';

const jsonResponse = (body, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
});

beforeEach(() => {
    resetFxCache();
});

afterEach(() => {
    mock.restoreAll();
});

describe('fetchFxRate', () => {
    test('same-currency call returns 1 with zero fetch calls', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', async () => jsonResponse({ rates: { EUR: 1.23 } }));
        const rate = await fetchFxRate('EUR', 'EUR');
        assert.equal(rate, 1);
        assert.equal(fetchMock.mock.callCount(), 0);
    });

    test('a valid numeric rate is returned and cached across a second call', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', async () => jsonResponse({ rates: { EUR: 0.92 } }));
        const first = await fetchFxRate('USD', 'EUR');
        const second = await fetchFxRate('USD', 'EUR');
        assert.equal(first, 0.92);
        assert.equal(second, 0.92);
        assert.equal(fetchMock.mock.callCount(), 1);
    });

    test('a genuine 1:1 rate between distinct currencies is cached and reused', async () => {
        const fetchMock = mock.method(globalThis, 'fetch', async () => jsonResponse({ rates: { YYY: 1 } }));
        const first = await fetchFxRate('XXX', 'YYY');
        const second = await fetchFxRate('XXX', 'YYY');
        assert.equal(first, 1);
        assert.equal(second, 1);
        assert.equal(fetchMock.mock.callCount(), 1);
    });

    test('a missing rates[to] returns 1, is not cached, and a later valid call succeeds', async () => {
        let call = 0;
        mock.method(globalThis, 'fetch', async () => {
            call += 1;
            if (call === 1) return jsonResponse({ rates: {} });
            return jsonResponse({ rates: { EUR: 0.85 } });
        });
        const first = await fetchFxRate('USD', 'EUR');
        assert.equal(first, 1);
        const second = await fetchFxRate('USD', 'EUR');
        assert.equal(second, 0.85);
    });

    test('a non-ok response with a JSON body returns 1 and is not cached', async () => {
        mock.method(globalThis, 'fetch', async () => jsonResponse({ error: 'rate limited' }, false, 429));
        const rate = await fetchFxRate('USD', 'EUR');
        assert.equal(rate, 1);
    });

    const invalidRates = [0, -1, NaN, Infinity, '1.08'];
    for (const invalid of invalidRates) {
        test(`invalid rate ${String(invalid)} is never cached`, async () => {
            const fetchMock = mock.method(globalThis, 'fetch', async () => jsonResponse({ rates: { EUR: invalid } }));
            const first = await fetchFxRate('USD', 'EUR');
            assert.equal(first, 1);
            await fetchFxRate('USD', 'EUR');
            assert.equal(fetchMock.mock.callCount(), 2);
        });
    }

    test('a rejected fetch returns 1 and never throws', async () => {
        mock.method(globalThis, 'fetch', async () => {
            throw new Error('network error');
        });
        const rate = await fetchFxRate('USD', 'EUR');
        assert.equal(rate, 1);
    });
});

describe('fetchJson', () => {
    test('rejects on a non-ok response', async () => {
        mock.method(globalThis, 'fetch', async () => jsonResponse({}, false, 500));
        await assert.rejects(() => fetchJson('https://example.test/data', 1000));
    });

    test('resolves the parsed JSON body on an ok response', async () => {
        mock.method(globalThis, 'fetch', async () => jsonResponse({ hello: 'world' }));
        const data = await fetchJson('https://example.test/data', 1000);
        assert.deepEqual(data, { hello: 'world' });
    });
});
