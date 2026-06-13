/**
 * Apply command-line overrides onto a loaded config. Lets you flex a run from
 * the CLI — a subset of dimensions, specific models, a different seed/concurrency
 * or output dirs — without editing the JSON. Pure and validated so bad input
 * fails fast with a clear message.
 */
import { DIMENSION_IDS, type BenchmarkConfig } from '../domain/config.ts';
import type { DimensionId } from '../domain/types.ts';

export interface RunOverrides {
  seed?: string;
  concurrency?: number;
  goLiveThreshold?: number;
  dimensions?: string[];
  models?: string[];
  datasetsDir?: string;
  resultsDir?: string;
}

/** Parse a comma/space separated CLI list into trimmed, non-empty tokens. */
export function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function applyOverrides(config: BenchmarkConfig, o: RunOverrides): BenchmarkConfig {
  const next: BenchmarkConfig = structuredClone(config);

  if (o.seed !== undefined) next.seed = o.seed;
  if (o.concurrency !== undefined) {
    if (!Number.isFinite(o.concurrency) || o.concurrency < 1) {
      throw new Error(`--concurrency must be a positive integer (got "${o.concurrency}")`);
    }
    next.concurrency = Math.floor(o.concurrency);
  }
  if (o.goLiveThreshold !== undefined) next.goLiveThreshold = o.goLiveThreshold;
  if (o.datasetsDir) next.datasetsDir = o.datasetsDir;
  if (o.resultsDir) next.resultsDir = o.resultsDir;

  if (o.dimensions && o.dimensions.length > 0) {
    const unknown = o.dimensions.filter((d) => !DIMENSION_IDS.includes(d as DimensionId));
    if (unknown.length > 0) {
      throw new Error(
        `--dimensions contains unknown id(s): ${unknown.join(', ')}. Valid: ${DIMENSION_IDS.join(', ')}`,
      );
    }
    next.dimensions = o.dimensions as DimensionId[];
  }

  if (o.models && o.models.length > 0) {
    const wanted = new Set(o.models);
    const filtered = next.models.filter((m) => wanted.has(m.id));
    if (filtered.length === 0) {
      const available = next.models.map((m) => m.id).join(', ');
      throw new Error(`--models matched none of the config's models. Available: ${available}`);
    }
    next.models = filtered;
  }

  return next;
}
