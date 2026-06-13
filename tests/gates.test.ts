import { describe, expect, it } from 'vitest';
import { evaluateGates } from '../src/domain/gates.ts';
import type { GateConfig } from '../src/domain/config.ts';
import type { DimensionResult } from '../src/domain/types.ts';

const dims: DimensionResult[] = [
  {
    dimensionId: 'zh-tw',
    group: 'capability',
    method: 'objective',
    rawScore: 72,
    cases: [],
    metrics: { accuracyPct: 72 },
    datasetVersion: 'v',
    datasetChecksum: 'c',
  },
  {
    dimensionId: 'performance',
    group: 'performance-cost',
    method: 'performance',
    rawScore: 88,
    cases: [],
    metrics: { p95TtftMs: 1500, errorRatePct: 0.2 },
    datasetVersion: 'v',
    datasetChecksum: 'c',
  },
];

describe('evaluateGates', () => {
  it('resolves dimension and metric selectors', () => {
    const gates: GateConfig[] = [
      { id: 'g1', label: 'zh', metric: 'dimension:zh-tw', comparator: '>=', threshold: 70, severity: 'blocking' },
      { id: 'g2', label: 'ttft', metric: 'metric:performance.p95TtftMs', comparator: '<', threshold: 2000, severity: 'blocking' },
      { id: 'g3', label: 'err', metric: 'metric:performance.errorRatePct', comparator: '<', threshold: 0.5, severity: 'blocking' },
    ];
    const { results, passed } = evaluateGates(gates, dims);
    expect(passed).toBe(true);
    expect(results.find((r) => r.id === 'g1')!.actual).toBe(72);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('fails a blocking gate below threshold', () => {
    const gates: GateConfig[] = [
      { id: 'g', label: 'zh', metric: 'dimension:zh-tw', comparator: '>=', threshold: 80, severity: 'blocking' },
    ];
    const { passed } = evaluateGates(gates, dims);
    expect(passed).toBe(false);
  });

  it('does not block when only a warning gate fails', () => {
    const gates: GateConfig[] = [
      { id: 'g', label: 'zh', metric: 'dimension:zh-tw', comparator: '>=', threshold: 80, severity: 'warning' },
    ];
    const { results, passed } = evaluateGates(gates, dims);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.severity).toBe('warning');
    expect(passed).toBe(true);
  });

  it('reports NaN and does not block for an un-run dimension', () => {
    const gates: GateConfig[] = [
      { id: 'g', label: 'missing', metric: 'dimension:code', comparator: '>=', threshold: 50, severity: 'blocking' },
    ];
    const { results, passed } = evaluateGates(gates, dims);
    expect(Number.isNaN(results[0]!.actual)).toBe(true);
    expect(passed).toBe(true);
  });
});
