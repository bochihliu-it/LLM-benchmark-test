import { describe, expect, it } from 'vitest';
import {
  aggregate,
  exactMatch,
  extractNumber,
  numericMatch,
  passAtK,
  percentile,
  performanceScore,
  efficiency,
} from '../src/domain/scoring.ts';
import type { DimensionResult } from '../src/domain/types.ts';

describe('exact / numeric matching', () => {
  it('matches answers ignoring case, spacing and trailing punctuation', () => {
    expect(exactMatch('Paris.', 'paris')).toBe(true);
    expect(exactMatch('B', ' b ')).toBe(true);
    expect(exactMatch('Berlin', 'Paris')).toBe(false);
  });

  it('extracts the first number from messy text', () => {
    expect(extractNumber('The answer is $1,250.50 total')).toBeCloseTo(1250.5);
    expect(extractNumber('no digits here')).toBeNull();
  });

  it('numericMatch respects tolerance', () => {
    expect(numericMatch(10, 10)).toBe(true);
    expect(numericMatch(10.0001, 10, 0.001)).toBe(true);
    expect(numericMatch(11, 10, 0.001)).toBe(false);
    expect(numericMatch(null, 10)).toBe(false);
  });
});

describe('passAtK', () => {
  it('is 0 when nothing passes and 1 when everything passes', () => {
    expect(passAtK(5, 0, 1)).toBe(0);
    expect(passAtK(5, 5, 1)).toBe(1);
  });
  it('is monotonic in k', () => {
    expect(passAtK(10, 3, 2)).toBeGreaterThan(passAtK(10, 3, 1));
  });
});

describe('percentile', () => {
  it('interpolates linearly', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('performanceScore', () => {
  it('rewards low latency and high throughput', () => {
    const fast = performanceScore({ p95TtftMs: 300, tpotMs: 10, tokensPerSec: 120, errorRate: 0 });
    const slow = performanceScore({ p95TtftMs: 4000, tpotMs: 80, tokensPerSec: 10, errorRate: 0.1 });
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThanOrEqual(100);
    expect(slow).toBeGreaterThanOrEqual(0);
  });
});

describe('aggregate', () => {
  const dims: DimensionResult[] = [
    mkDim('general', 'capability', 80),
    mkDim('rag', 'application', 60),
    mkDim('safety', 'reliability-safety', 100),
    mkDim('performance', 'performance-cost', 90),
  ];

  it('weights groups and produces an overall in range', () => {
    const out = aggregate(dims, {
      capability: 0.4,
      application: 0.25,
      'reliability-safety': 0.15,
      'performance-cost': 0.2,
    });
    // 0.4*80 + 0.25*60 + 0.15*100 + 0.2*90 = 32 + 15 + 15 + 18 = 80
    expect(out.overall).toBeCloseTo(80, 1);
    expect(out.perDimension.general).toBe(80);
  });

  it('renormalizes when a group is missing', () => {
    const partial = aggregate([mkDim('general', 'capability', 50)], {
      capability: 0.4,
      application: 0.25,
      'reliability-safety': 0.15,
      'performance-cost': 0.2,
    });
    expect(partial.overall).toBeCloseTo(50, 1);
  });
});

describe('efficiency', () => {
  it('is benefit per GPU unit, or null without vram', () => {
    expect(efficiency(80, 16)).toBe(5);
    expect(efficiency(80, undefined)).toBeNull();
  });
});

function mkDim(
  id: DimensionResult['dimensionId'],
  group: DimensionResult['group'],
  rawScore: number,
): DimensionResult {
  return {
    dimensionId: id,
    group,
    method: 'objective',
    rawScore,
    cases: [],
    metrics: {},
    datasetVersion: 'test',
    datasetChecksum: 'test',
  };
}
