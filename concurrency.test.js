import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
    test('preserves input order regardless of completion order', async () => {
        const delays = [30, 5, 15];
        const output = await mapWithConcurrency(delays, 3, async (delay, index) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return index * 10;
        });
        assert.deepEqual(output, [0, 10, 20]);
    });

    test('never exceeds the concurrency limit', async () => {
        let active = 0;
        let peak = 0;

        await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
        });

        assert.equal(peak, 3);
    });

    test('handles an empty list', async () => {
        assert.deepEqual(await mapWithConcurrency([], 5, async () => 1), []);
    });

    test('propagates a worker error', async () => {
        await assert.rejects(
            mapWithConcurrency([1, 2], 2, async (value) => {
                if (value === 2) throw new Error('boom');
                return value;
            }),
            /boom/
        );
    });
});
