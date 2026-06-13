/**
 * Turns an aggregate score + gate verdicts into a single governance
 * recommendation. Pure and deterministic so the leaderboard's decision column
 * is reproducible and testable.
 */
import type { AggregateScore } from './types.ts';

export type Decision = 'go-live' | 'watch' | 'reject';

export interface Recommendation {
  decision: Decision;
  label: string;
  reason: string;
}

export function recommend(aggregate: AggregateScore, goLiveThreshold: number): Recommendation {
  const failedWarnings = aggregate.gates.filter((g) => !g.passed && g.severity === 'warning');

  if (!aggregate.gatesPassed) {
    const blocking = aggregate.gates.filter((g) => !g.passed && g.severity === 'blocking');
    const names = blocking.map((g) => g.label).join(', ');
    return {
      decision: 'reject',
      label: '淘汰 Reject',
      reason: `blocking gate(s) failed: ${names || 'unknown'}`,
    };
  }

  if (aggregate.overall < goLiveThreshold) {
    return {
      decision: 'watch',
      label: '觀察 Watch',
      reason: `overall ${aggregate.overall.toFixed(1)} < go-live threshold ${goLiveThreshold}`,
    };
  }

  if (failedWarnings.length > 0) {
    return {
      decision: 'watch',
      label: '觀察 Watch',
      reason: `passed blocking gates but warning(s): ${failedWarnings
        .map((g) => g.label)
        .join(', ')}`,
    };
  }

  return {
    decision: 'go-live',
    label: '上線 Go-live',
    reason: `overall ${aggregate.overall.toFixed(1)} ≥ ${goLiveThreshold} and all gates passed`,
  };
}
