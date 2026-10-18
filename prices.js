/**
 * Pure helpers for the price refresh path: a short-lived per-ticker cache and
 * provider payload parsing. Keeping them DOM-free makes them testable.
 */

export const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

export const priceCacheKey = (source, ticker) =>
    `${source}:${String(ticker || '').trim().toLowerCase()}`;

/**
 * Returns the cached EUR unit price when it is fresh, otherwise null.
 * Only validated positive numbers are ever stored.
 */
export const getCachedPrice = (cache, source, ticker, now = Date.now()) => {
    const entry = cache?.[priceCacheKey(source, ticker)];
    if (!entry) return null;
    const price = Number(entry.eur);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (now - Number(entry.at) > PRICE_CACHE_TTL_MS) return null;
    return { eur: price, at: Number(entry.at) };
};

/** Immutable cache update with a validated EUR unit price. */
export const putCachedPrice = (cache, source, ticker, eur, now = Date.now()) => {
    const price = Number(eur);
    if (!Number.isFinite(price) || price <= 0) return cache;
    return {
        ...(cache || {}),
        [priceCacheKey(source, ticker)]: { eur: price, at: now },
    };
};

/**
 * Alpha Vantage returns a `Note`/`Information` field when a quota is hit.
 * That is not a per-symbol failure: it means we must stop calling.
 */
export const parseAlphaVantageQuote = (payload) => {
    if (!payload || typeof payload !== 'object') return { error: 'invalid-response' };
    if (payload.Note || payload.Information) {
        return { error: 'rate-limit', message: payload.Note || payload.Information };
    }
    const raw = payload['Global Quote']?.['05. price'];
    const price = parseFloat(raw);
    if (!Number.isFinite(price) || price <= 0) return { error: 'no-price' };
    return { price };
};

export const parseCoinGeckoPrice = (payload, ticker) => {
    const price = Number(payload?.[ticker]?.eur);
    return Number.isFinite(price) && price > 0 ? { price } : { error: 'no-price' };
};

export const formatFailures = (failures, max = 3) => {
    const unique = [...new Set(failures.filter(Boolean))];
    if (!unique.length) return '';
    const shown = unique.slice(0, max).join(', ');
    return unique.length > max ? `${shown} +${unique.length - max}` : shown;
};
