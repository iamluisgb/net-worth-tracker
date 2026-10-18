/**
 * Run an async worker over items with a bounded number in flight.
 * Keeps provider bursts polite without imposing artificial per-item delays.
 */
export const mapWithConcurrency = async (items, limit, worker) => {
    const list = Array.from(items || []);
    const results = new Array(list.length);
    let next = 0;

    const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
        for (;;) {
            const index = next++;
            if (index >= list.length) return;
            results[index] = await worker(list[index], index);
        }
    });

    await Promise.all(runners);
    return results;
};
