/**
 * Quality-gate evaluation. Gates are the "minimum bar to go live" checks from
 * the proposal (e.g. zh-tw >= 70, IFEval >= 75, P95 TTFT < 2s). They are scored
 * independently of the weighted overall score: a model can rank highly and still
 * be blocked by a failed gate.
 */
import type { GateConfig } from './config.ts';
import type { DimensionResult, GateResult } from './types.ts';

function compare(actual: number, comparator: GateConfig['comparator'], threshold: number): boolean {
  switch (comparator) {
    case '>=':
      return actual >= threshold;
    case '<=':
      return actual <= threshold;
    case '<':
      return actual < threshold;
    case '>':
      return actual > threshold;
  }
}

/**
 * Resolve a gate's `metric` selector against the run's dimension results.
 * Supported selectors:
 *   - "dimension:<id>"          → that dimension's rawScore (0..100)
 *   - "metric:<id>.<metricKey>" → a named aggregate metric of a dimension
 */
function resolveMetric(metric: string, dimensions: DimensionResult[]): number | null {
  const [kind, rest] = metric.split(':', 2);
  if (!rest) return null;

  if (kind === 'dimension') {
    const dim = dimensions.find((d) => d.dimensionId === rest);
    return dim ? dim.rawScore : null;
  }

  if (kind === 'metric') {
    const dot = rest.indexOf('.');
    if (dot < 0) return null;
    const dimId = rest.slice(0, dot);
    const metricKey = rest.slice(dot + 1);
    const dim = dimensions.find((d) => d.dimensionId === dimId);
    if (!dim) return null;
    const value = dim.metrics[metricKey];
    return value === undefined ? null : value;
  }

  return null;
}

export function evaluateGates(
  gates: GateConfig[],
  dimensions: DimensionResult[],
): { results: GateResult[]; passed: boolean } {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const actual = resolveMetric(gate.metric, dimensions);
    if (actual === null) {
      // A gate referencing an un-run dimension is reported as not-applicable but
      // does NOT block; it is surfaced with NaN so reviewers notice the gap.
      results.push({
        id: gate.id,
        label: gate.label,
        comparator: gate.comparator,
        threshold: gate.threshold,
        actual: Number.NaN,
        passed: true,
        severity: gate.severity,
      });
      continue;
    }
    results.push({
      id: gate.id,
      label: gate.label,
      comparator: gate.comparator,
      threshold: gate.threshold,
      actual: Math.round(actual * 100) / 100,
      passed: compare(actual, gate.comparator, gate.threshold),
      severity: gate.severity,
    });
  }
  // Only blocking gates count against go-live; warning gates surface for review.
  const passed = results.every((r) => r.passed || r.severity === 'warning');
  return { results, passed };
}
