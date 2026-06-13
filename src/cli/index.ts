#!/usr/bin/env node
/**
 * CLI entry point for the AI Benchmark.
 *
 *   benchmark run    --config <path>   run all models in a config end-to-end
 *   benchmark report --results <dir> --out <dir>   regenerate the leaderboard
 *
 * The same `run` command works against the offline mock provider and a real
 * LiteLLM gateway — the only difference is the config's `provider` field.
 */
import { parseArgs } from './args.ts';
import { loadConfig, runBenchmark } from '../application/run-benchmark.ts';
import { validateConfig } from '../application/validate.ts';
import { ResultStore } from '../infrastructure/result-store.ts';
import { ReportWriter } from '../application/report-writer.ts';
import { DATASET_FILES } from '../infrastructure/dataset-loader.ts';
import { RUNNERS } from '../../pipeline/runners/registry.ts';
import { createLogger } from '../infrastructure/logger.ts';
import type { DimensionId } from '../domain/types.ts';

const USAGE = `AI Benchmark — standardized LLM evaluation behind LiteLLM

Usage:
  benchmark run      --config <path> [--reports <dir>] [--log <level>]
  benchmark validate --config <path>
  benchmark list
  benchmark report   [--results <dir>] [--out <dir>]

Examples:
  pnpm benchmark:sample
  pnpm benchmark run --config pipeline/configs/sample-suite.json
  pnpm benchmark validate --config pipeline/configs/sample-model.json
  pnpm benchmark list
  pnpm benchmark report --results results --out reports
`;

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const logger = createLogger((options.log as 'info') ?? 'info');

  switch (command) {
    case 'run': {
      const configPath = options.config;
      if (!configPath) {
        logger.error('Missing --config <path>');
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }
      const config = await loadConfig(configPath);
      const results = await runBenchmark(config, {
        reportsDir: options.reports ?? 'reports',
        logger,
      });
      const blocked = results.filter((r) => !r.aggregate.gatesPassed).length;
      logger.info(
        `Done. ${results.length} model(s) evaluated; ${blocked} blocked by quality gates.`,
      );
      return;
    }

    case 'validate': {
      const configPath = options.config;
      if (!configPath) {
        logger.error('Missing --config <path>');
        process.exitCode = 1;
        return;
      }
      const config = await loadConfig(configPath);
      const report = await validateConfig(config);
      for (const s of report.summary) {
        logger.info(`  ✓ ${s.dimension}: ${s.cases} cases (${s.version})`);
      }
      for (const issue of report.issues) {
        const line = `${issue.scope}: ${issue.message}`;
        if (issue.level === 'error') logger.error(`  ✗ ${line}`);
        else logger.warn(`  ⚠ ${line}`);
      }
      if (report.ok) {
        logger.info(`Config OK — ${report.summary.length} dimension dataset(s) validated.`);
      } else {
        logger.error('Config has errors; fix them before running.');
        process.exitCode = 1;
      }
      return;
    }

    case 'list': {
      console.log('Available dimensions:\n');
      for (const id of Object.keys(RUNNERS) as DimensionId[]) {
        console.log(
          `  ${id.padEnd(12)} method=${RUNNERS[id].method.padEnd(12)} dataset=${DATASET_FILES[id]}`,
        );
      }
      console.log('\nDecision groups: capability, application, reliability-safety, performance-cost');
      return;
    }

    case 'report': {
      const store = new ResultStore(options.results ?? 'results');
      const reporter = new ReportWriter(options.out ?? 'reports');
      const all = await store.loadAll();
      if (all.length === 0) {
        logger.warn('No results found to report on.');
        return;
      }
      const path = await reporter.writeLeaderboard(all);
      logger.info(`Leaderboard written: ${path} (${all.length} models)`);
      return;
    }

    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE);
      return;

    default:
      logger.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
