import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    PRICE_CACHE_TTL_MS,
    priceCacheKey,
    getCachedPrice,
    putCachedPrice,
    parseAlphaVantageQuote,
    parseCoinGeckoPrice,
    formatFailures,
} from './prices.js';

describe('price cache', () => {
    test('returns a fresh validated EUR price', () => {
        const cache = putCachedPrice({}, 'coingecko', 'Bitcoin', 50000, 1000);
        const hit = getCachedPrice(cache, 'coingecko', 'bitcoin', 1000 + 1000);
        assert.equal(hit.eur, 50000);
    });

    test('keys are source and ticker, case insensitive', () => {
        assert.equal(priceCacheKey('coingecko', ' BTC '), 'coingecko:btc');
    });

    test('expires after the TTL', () => {
        const cache = putCachedPrice({}, 'alphavantage', 'AAPL', 200, 0);
        assert.equal(getCachedPrice(cache, 'alphavantage', 'AAPL', PRICE_CACHE_TTL_MS + 1), null);
    });

    test('never caches invalid prices', () => {
        const cache = putCachedPrice({}, 'alphavantage', 'AAPL', 0, 0);
        assert.deepEqual(cache, {});
    });

    test('different sources do not collide', () => {
        const cache = putCachedPrice({}, 'coingecko', 'ETH', 3000, 0);
        assert.equal(getCachedPrice(cache, 'alphavantage', 'ETH', 0), null);
    });
});

describe('Alpha Vantage payload', () => {
    test('parses a normal quote', () => {
        const parsed = parseAlphaVantageQuote({ 'Global Quote': { '05. price': '189.5200' } });
        assert.equal(parsed.price, 189.52);
    });

    test('detects the daily/minute quota note', () => {
        const parsed = parseAlphaVantageQuote({
            Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.',
        });
        assert.equal(parsed.error, 'rate-limit');
        assert.match(parsed.message, /25 requests per day/);
    });

    test('treats an empty quote as no price', () => {
        assert.equal(parseAlphaVantageQuote({ 'Global Quote': {} }).error, 'no-price');
    });
});

describe('CoinGecko payload', () => {
    test('reads the EUR price for the requested id', () => {
        assert.equal(parseCoinGeckoPrice({ bitcoin: { eur: 61000 } }, 'bitcoin').price, 61000);
    });

    test('missing ids are reported, not coerced to zero', () => {
        assert.equal(parseCoinGeckoPrice({}, 'bitcoin').error, 'no-price');
    });
});

test('formatFailures deduplicates and caps the list', () => {
    assert.equal(formatFailures(['AAPL', 'AAPL', 'BTC', 'ETH', 'VWRA']), 'AAPL, BTC, ETH +1');
    assert.equal(formatFailures([]), '');
});
