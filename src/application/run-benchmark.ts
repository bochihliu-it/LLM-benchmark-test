/**
 * Top-level use case: load a config, run every model through the orchestrator,
 * persist results, and (re)generate reports and the leaderboard.
 */
import { readFile } from 'node:fs/promises';
import { parseConfig, type BenchmarkConfig } from '../domain/config.ts';
import type { BenchmarkResult } from '../domain/types.ts';
import { createJudge, createModelClient } from '../infrastructure/client-factory.ts';
import { DatasetLoader } from '../infrastructure/dataset-loader.ts';
import { ResultStore } from '../infrastructure/result-store.ts';
import { createLogger, type Logger } from '../infrastructure/logger.ts';
import { runModel } from './orchestrator.ts';
import { ReportWriter } from './report-writer.ts';

export async function loadConfig(path: string): Promise<BenchmarkConfig> {
  const raw = await readFile(path, 'utf8');
  return parseConfig(JSON.parse(raw));
}

export interface RunOptions {
  reportsDir: string;
  logger?: Logger;
}

export async function runBenchmark(
  config: BenchmarkConfig,
  opts: RunOptions,
): Promise<BenchmarkResult[]> {
  const logger = opts.logger ?? createLogger('info');
  const loader = new DatasetLoader(config.datasetsDir);
  const judge = createJudge(config, logger);
  const store = new ResultStore(config.resultsDir);
  const reporter = new ReportWriter(opts.reportsDir, config.goLiveThreshold);

  logger.info(
    `Starting "${config.name}" — ${config.models.length} model(s) × ${config.dimensions.length} dimension(s)`,
  );

  const results: BenchmarkResult[] = [];
  for (const model of config.models) {
    const client = createModelClient(model, config, logger);
    const result = await runModel(model, client, { config, loader, judge, logger });
    const savedTo = await store.save(result);
    const reportTo = await reporter.writeRunReport(result);
    logger.info(
      `★ ${model.label}: overall ${result.aggregate.overall.toFixed(1)}/100 — gates ${
        result.aggregate.gatesPassed ? 'PASS' : 'FAIL'
      }`,
    );
    logger.info(`  results: ${savedTo}`);
    logger.info(`  report:  ${reportTo}`);
    results.push(result);
  }

  // Refresh the leaderboard from the full result history, not just this run.
  const all = await store.loadAll();
  const board = all.length ? all : results;
  const boardPath = await reporter.writeLeaderboard(board);
  logger.info(`Leaderboard updated: ${boardPath} (${board.length} models)`);

  return results;
}
