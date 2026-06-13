import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/shared/async.ts';

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const input = [50, 10, 30, 5, 20];
    const out = await mapWithConcurrency(input, 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([100, 20, 60, 10, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('handles empty input and clamps limit to >= 1', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x * 10)).toEqual([10, 20]);
  });
});
