// --- FX / Multi-currency ---

export const fetchJson = async (url, timeoutMs) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
};

const _fxCache = {};
export const fetchFxRate = async (from, to = 'EUR') => {
    if (from === to) return 1;
    const key = `${from}_${to}`;
    if (_fxCache[key]) return _fxCache[key];
    try {
        const data = await fetchJson(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, 8000);
        const rate = data.rates?.[to];
        if (Number.isFinite(rate) && rate > 0) {
            _fxCache[key] = rate;
            return rate;
        }
        return 1;
    } catch {
        return 1;
    }
};

export const resetFxCache = () => {
    for (const key of Object.keys(_fxCache)) {
        delete _fxCache[key];
    }
};
