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
import { join } from 'node:path';
import { parseArgs } from './args.ts';
import { applyOverrides, parseList } from './overrides.ts';
import { loadConfig, runBenchmark } from '../application/run-benchmark.ts';
import { validateConfig } from '../application/validate.ts';
import { ResultStore } from '../infrastructure/result-store.ts';
import { ReportWriter } from '../application/report-writer.ts';
import { DATASET_FILES } from '../infrastructure/dataset-loader.ts';
import { RUNNERS } from '../../pipeline/runners/registry.ts';
import { createLogger, createFileSink, type LogLevel } from '../infrastructure/logger.ts';
import type { DimensionId } from '../domain/types.ts';

const USAGE = `AI Benchmark — standardized LLM evaluation behind LiteLLM

Usage:
  benchmark run      --config <path> [overrides] [logging]
  benchmark validate --config <path>
  benchmark list
  benchmark report   [--results <dir>] [--out <dir>]

Run overrides (flex a run without editing the config):
  --dimensions a,b,c   run only these dimensions
  --models id1,id2     run only these model ids
  --seed <s>           override the reproducibility seed
  --concurrency <n>    override per-dimension concurrency
  --go-live <n>        override the go-live overall threshold
  --reports <dir>      report output dir (default: reports)
  --results <dir>      results output dir (overrides config.resultsDir)
  --datasets <dir>     datasets dir (overrides config.datasetsDir)
  --no-report          skip writing reports/leaderboard

Logging:
  --log <level>        console level: debug|info|warn|error (default: info)
  --log-file <path>    run log file (default: logs/run__<name>__<stamp>.log)
  --no-log-file        do not write a run log file

Examples:
  pnpm benchmark:sample
  pnpm benchmark run --config pipeline/configs/sample-suite.json --dimensions general,code
  pnpm benchmark run --config pipeline/configs/sample-suite.json --models sample-llama-70b
  pnpm benchmark validate --config pipeline/configs/sample-model.json
  pnpm benchmark list
`;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main(): Promise<void> {
  const { command, options, flags } = parseArgs(process.argv.slice(2));
  const logLevel = (options.log as LogLevel) ?? 'info';
  const logger = createLogger(logLevel);

  switch (command) {
    case 'run': {
      const configPath = options.config;
      if (!configPath) {
        logger.error('Missing --config <path>');
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }

      let config = await loadConfig(configPath);
      try {
        config = applyOverrides(config, {
          seed: options.seed,
          concurrency: options.concurrency ? Number(options.concurrency) : undefined,
          goLiveThreshold: options['go-live'] ? Number(options['go-live']) : undefined,
          dimensions: parseList(options.dimensions),
          models: parseList(options.models),
          datasetsDir: options.datasets,
          resultsDir: options.results,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      // Attach a durable run log unless disabled.
      if (!flags.has('no-log-file')) {
        const safeName = config.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const logFile = options['log-file'] ?? join('logs', `run__${safeName}__${timestamp()}.log`);
        logger.addSink(createFileSink(logFile));
        logger.info(`Run log: ${logFile}`);
      }

      const results = await runBenchmark(config, {
        reportsDir: options.reports ?? 'reports',
        writeReports: !flags.has('no-report'),
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
