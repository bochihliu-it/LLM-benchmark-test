/**
 * The orchestrator is the centerpiece: it runs every enabled dimension for one
 * model in a single pass, then folds the heterogeneous dimension results into
 * one aggregate score plus gate verdicts. Because each runner shares the same
 * interface, "can the dimensions be tested together?" is answered structurally —
 * adding a dimension is registering a runner, nothing else changes.
 */
import { randomUUID } from 'node:crypto';
import type { BenchmarkConfig, ModelConfig } from '../domain/config.ts';
import type {
  BenchmarkResult,
  DimensionGroup,
  DimensionId,
  DimensionResult,
  ModelClient,
} from '../domain/types.ts';
import { aggregate } from '../domain/scoring.ts';
import { evaluateGates } from '../domain/gates.ts';
import type { Judge } from './judge.ts';
import type { DatasetLoader } from '../infrastructure/dataset-loader.ts';
import type { Logger } from '../infrastructure/logger.ts';
import { getRunner } from '../../pipeline/runners/registry.ts';
import { makeSampler, type RunContext } from '../../pipeline/runners/runner.ts';

export interface OrchestratorDeps {
  config: BenchmarkConfig;
  loader: DatasetLoader;
  judge: Judge;
  logger: Logger;
}

export async function runModel(
  model: ModelConfig,
  client: ModelClient,
  deps: OrchestratorDeps,
): Promise<BenchmarkResult> {
  const { config, loader, judge, logger } = deps;
  const startedAt = new Date().toISOString();

  const ctx: RunContext = {
    client,
    judge,
    logger,
    config,
    groupFor: (dim) => groupFor(dim, config),
    sampleForReview: makeSampler(`${config.seed}:${model.id}`, config.humanReviewSampleRate),
  };

  const dimensions: DimensionResult[] = [];
  for (const dimId of config.dimensions) {
    const runner = getRunner(dimId);
    logger.info(`▶ ${model.label}: running dimension "${dimId}" (${runner.method})`);
    try {
      const dataset = await loader.load(dimId);
      const result = await runner.run(dataset, ctx);
      logger.info(`  ✓ ${dimId}: ${result.rawScore.toFixed(1)}/100`);
      dimensions.push(result);
    } catch (err) {
      logger.error(`  ✗ ${dimId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const aggCore = aggregate(dimensions, config.weights);
  const gates = evaluateGates(config.gates, dimensions);

  return {
    runId: randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    model: {
      id: model.id,
      provider: model.provider,
      label: model.label,
      params: model.params,
      quantization: model.quantization,
      vramGb: model.vramGb,
    },
    environment: {
      harnessVersion: '0.1.0',
      node: process.version,
      seed: config.seed,
      judgeModel: judge.model,
      judgeVersion: judge.version,
      litellmBaseUrl: model.provider === 'mock' ? 'mock://offline' : config.litellm.baseUrl,
    },
    dimensions,
    aggregate: {
      ...aggCore,
      gates: gates.results,
      gatesPassed: gates.passed,
    },
  };
}

function groupFor(dim: DimensionId, config: BenchmarkConfig): DimensionGroup {
  return config.groups[dim] ?? 'capability';
}
