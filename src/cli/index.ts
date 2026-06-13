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
import { ResultStore } from '../infrastructure/result-store.ts';
import { ReportWriter } from '../application/report-writer.ts';
import { createLogger } from '../infrastructure/logger.ts';

const USAGE = `AI Benchmark — standardized LLM evaluation behind LiteLLM

Usage:
  benchmark run     --config <path> [--reports <dir>] [--log <level>]
  benchmark report  [--results <dir>] [--out <dir>]

Examples:
  pnpm benchmark:sample
  pnpm benchmark run --config pipeline/configs/sample-suite.json
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
