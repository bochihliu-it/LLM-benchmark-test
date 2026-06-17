/**
 * Pure scoring primitives. No IO, no model calls — everything here is a function
 * of its inputs so it can be unit-tested and so reruns are reproducible.
 */
import type {
  AggregateScore,
  DimensionGroup,
  DimensionResult,
  LatencyMetrics,
} from './types.ts';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Percentile (linear interpolation) over a numeric sample. p in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (clamp(p, 0, 100) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const weight = rank - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

/** Loose string normalization for exact-match comparison. */
export function normalizeAnswer(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s,]+/g, ' ')
    .replace(/[.。!！?？]+$/g, '');
}

export function exactMatch(predicted: string, expected: string): boolean {
  return normalizeAnswer(predicted) === normalizeAnswer(expected);
}

/** Extract the first number from free text, tolerating $ , % and words. */
export function extractNumber(text: string): number | null {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

export function numericMatch(
  predicted: number | null,
  expected: number,
  tolerance = 1e-6,
): boolean {
  if (predicted === null) return false;
  return Math.abs(predicted - expected) <= tolerance;
}

/**
 * Unbiased pass@k estimator (Chen et al., 2021): given `n` samples of which `c`
 * passed, the expected probability that at least one of `k` drawn samples passes.
 */
export function passAtK(n: number, c: number, k: number): number {
  if (n - c < k) return 1;
  let prob = 1;
  for (let i = n - c + 1; i <= n; i++) {
    prob *= 1 - k / i;
  }
  return 1 - prob;
}

/**
 * Map latency/throughput to a [0, 100] performance score against soft targets.
 * Rewards low TTFT and high throughput; degrades gracefully rather than as a
 * hard cliff so near-miss models stay comparable.
 */
export function performanceScore(opts: {
  p95TtftMs: number;
  tokensPerSec: number;
  errorRate: number;
  targetP95TtftMs?: number;
  targetTokensPerSec?: number;
}): number {
  const targetTtft = opts.targetP95TtftMs ?? 2000;
  const targetTps = opts.targetTokensPerSec ?? 40;

  const ttftScore = clamp(targetTtft / Math.max(opts.p95TtftMs, 1), 0, 1);
  const tpsScore = clamp(opts.tokensPerSec / targetTps, 0, 1);
  const reliabilityScore = clamp(1 - opts.errorRate * 20, 0, 1);

  const blended = 0.45 * ttftScore + 0.4 * tpsScore + 0.15 * reliabilityScore;
  return Math.round(blended * 1000) / 10; // one decimal, 0..100
}

export function aggregateLatency(samples: LatencyMetrics[]): {
  p50TtftMs: number;
  p95TtftMs: number;
  meanTotalMs: number;
  meanTpotMs: number;
} {
  const ttfts = samples.map((s) => s.ttftMs);
  return {
    p50TtftMs: Math.round(percentile(ttfts, 50)),
    p95TtftMs: Math.round(percentile(ttfts, 95)),
    meanTotalMs: Math.round(mean(samples.map((s) => s.totalMs))),
    meanTpotMs: Math.round(mean(samples.map((s) => s.tpotMs)) * 10) / 10,
  };
}

/**
 * Combine per-dimension scores into a weighted overall score using the
 * decision-matrix group weights. Groups with no measured dimension are dropped
 * and the remaining weights renormalized, so a partial run still ranks fairly.
 */
export function aggregate(
  dimensions: DimensionResult[],
  weights: Record<DimensionGroup, number>,
): Pick<AggregateScore, 'overall' | 'groups' | 'perDimension'> {
  const perDimension: Record<string, number> = {};
  const byGroup = new Map<DimensionGroup, number[]>();

  for (const dim of dimensions) {
    perDimension[dim.dimensionId] = Math.round(dim.rawScore * 10) / 10;
    const bucket = byGroup.get(dim.group) ?? [];
    bucket.push(dim.rawScore);
    byGroup.set(dim.group, bucket);
  }

  const groups = {} as AggregateScore['groups'];
  let weightSum = 0;
  for (const [group, scores] of byGroup) {
    const w = weights[group] ?? 0;
    weightSum += w;
    groups[group] = { weight: w, score: Math.round(mean(scores) * 10) / 10 };
  }
  // Fill groups that had a configured weight but no measured dimension.
  for (const group of Object.keys(weights) as DimensionGroup[]) {
    if (!groups[group]) groups[group] = { weight: 0, score: 0 };
  }

  let overall = 0;
  if (weightSum > 0) {
    for (const group of byGroup.keys()) {
      const g = groups[group];
      overall += (g.weight / weightSum) * g.score;
    }
  }

  return {
    overall: Math.round(overall * 10) / 10,
    groups,
    perDimension,
  };
}

/**
 * Benefit-per-GPU-unit ranking key: overall score divided by VRAM footprint.
 * Higher is better. Used to break ties on the leaderboard under the PCAI
 * resource constraint.
 */
export function efficiency(overall: number, vramGb?: number): number | null {
  if (!vramGb || vramGb <= 0) return null;
  return Math.round((overall / vramGb) * 100) / 100;
}
