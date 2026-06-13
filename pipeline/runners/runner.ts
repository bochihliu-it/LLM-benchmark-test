/**
 * The runner contract. Every evaluation dimension implements the same interface,
 * which is exactly what lets the orchestrator run heterogeneous dimensions
 * (objective MCQ, judge, performance) together in one pass and aggregate them.
 */
import type { BenchmarkConfig } from '../../src/domain/config.ts';
import type {
  CaseResult,
  Dataset,
  DimensionGroup,
  DimensionId,
  DimensionResult,
  EvaluationMethod,
  ModelClient,
} from '../../src/domain/types.ts';
import type { Judge } from '../../src/application/judge.ts';
import type { Logger } from '../../src/infrastructure/logger.ts';
import { seededFloat } from '../../src/shared/rng.ts';

export interface RunContext {
  client: ModelClient;
  judge: Judge;
  logger: Logger;
  config: BenchmarkConfig;
  groupFor(dimension: DimensionId): DimensionGroup;
  /** Deterministic human-review draw for a case. */
  sampleForReview(seedKey: string): boolean;
}

export interface DimensionRunner {
  readonly id: DimensionId;
  readonly method: EvaluationMethod;
  run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult>;
}

export function makeSampler(seed: string, rate: number): (seedKey: string) => boolean {
  return (seedKey: string) => rate > 0 && seededFloat(`${seed}:sample:${seedKey}`) < rate;
}

/** Assemble a DimensionResult from per-case results and a precomputed score. */
export function buildResult(opts: {
  dimensionId: DimensionId;
  group: DimensionGroup;
  method: EvaluationMethod;
  rawScore: number;
  cases: CaseResult[];
  metrics: Record<string, number>;
  dataset: Dataset;
}): DimensionResult {
  return {
    dimensionId: opts.dimensionId,
    group: opts.group,
    method: opts.method,
    rawScore: Math.round(opts.rawScore * 10) / 10,
    cases: opts.cases,
    metrics: opts.metrics,
    datasetVersion: opts.dataset.version,
    datasetChecksum: opts.dataset.checksum ?? 'unknown',
  };
}
