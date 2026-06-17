import { describe, expect, it } from 'vitest';
import { recommend } from '../src/domain/decision.ts';
import type { AggregateScore, GateResult } from '../src/domain/types.ts';

function gate(passed: boolean, severity: 'blocking' | 'warning'): GateResult {
  return { id: 'g', label: 'g', comparator: '>=', threshold: 1, actual: 1, passed, severity };
}

function agg(overall: number, gates: GateResult[]): AggregateScore {
  const gatesPassed = gates.every((g) => g.passed || g.severity === 'warning');
  return {
    overall,
    groups: {
      capability: { weight: 0.4, score: overall },
      application: { weight: 0.25, score: overall },
      'reliability-safety': { weight: 0.15, score: overall },
      'performance-cost': { weight: 0.2, score: overall },
    },
    perDimension: {},
    gates,
    gatesPassed,
  };
}

describe('recommend', () => {
  it('go-live when above threshold and all gates pass', () => {
    expect(recommend(agg(90, [gate(true, 'blocking')]), 75).decision).toBe('go-live');
  });

  it('reject when a blocking gate fails, regardless of score', () => {
    expect(recommend(agg(95, [gate(false, 'blocking')]), 75).decision).toBe('reject');
  });

  it('watch when gates pass but below threshold', () => {
    expect(recommend(agg(60, [gate(true, 'blocking')]), 75).decision).toBe('watch');
  });

  it('watch when above threshold but a warning gate failed', () => {
    const r = recommend(agg(90, [gate(false, 'warning')]), 75);
    expect(r.decision).toBe('watch');
    expect(r.reason).toContain('warning');
  });
});
