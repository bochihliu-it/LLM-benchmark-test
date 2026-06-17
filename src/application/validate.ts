/**
 * Static pre-flight validation: confirms a config's datasets exist, parse, and
 * carry the case kind each dimension expects, and that gates reference enabled
 * dimensions — all without making a single model call. Lets the SOP step
 * "prepare config" fail fast instead of mid-run.
 */
import type { BenchmarkConfig } from '../domain/config.ts';
import type { Category, DimensionId, TaskCase } from '../domain/types.ts';
import { CATEGORIES } from '../domain/types.ts';
import { DatasetLoader } from '../infrastructure/dataset-loader.ts';
import { RUNNERS } from '../../pipeline/runners/registry.ts';

const EXPECTED_KIND: Record<DimensionId, TaskCase['kind']> = {
  general: 'multiple-choice',
  'zh-tw': 'multiple-choice',
  reasoning: 'numeric',
  code: 'code',
  rag: 'judge',
  'tool-use': 'tool-use',
  safety: 'safety',
  performance: 'perf',
};

export interface ValidationIssue {
  level: 'error' | 'warning';
  scope: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  summary: { dimension: DimensionId; cases: number; version: string }[];
}

export async function validateConfig(config: BenchmarkConfig): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const summary: ValidationReport['summary'] = [];
  const loader = new DatasetLoader(config.datasetsDir);

  for (const dim of config.dimensions) {
    if (!RUNNERS[dim]) {
      issues.push({ level: 'error', scope: dim, message: `no runner registered for "${dim}"` });
      continue;
    }
    try {
      const dataset = await loader.load(dim);
      const expected = EXPECTED_KIND[dim];
      const mismatched = dataset.cases.filter((c) => c.kind !== expected);
      if (mismatched.length > 0) {
        issues.push({
          level: 'error',
          scope: dim,
          message: `${mismatched.length}/${dataset.cases.length} case(s) are not kind "${expected}" (e.g. "${mismatched[0]!.kind}")`,
        });
      }

      // Multiple-choice cases may carry a category tag (e.g. TMMLU+); if present
      // it must be one of the known categories so sub-scores bucket correctly.
      const badCategory = dataset.cases.filter((c) => {
        const cat = (c as { category?: string }).category;
        return cat !== undefined && !CATEGORIES.includes(cat as Category);
      });
      if (badCategory.length > 0) {
        issues.push({
          level: 'warning',
          scope: dim,
          message: `${badCategory.length} case(s) have an unknown category (allowed: ${CATEGORIES.join(', ')})`,
        });
      }

      summary.push({ dimension: dim, cases: dataset.cases.length, version: dataset.version });
    } catch (err) {
      issues.push({
        level: 'error',
        scope: dim,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Gates should reference dimensions that are actually being run.
  for (const gate of config.gates) {
    const ref = parseGateMetric(gate.metric);
    if (!ref) {
      issues.push({ level: 'warning', scope: `gate:${gate.id}`, message: `unrecognized metric selector "${gate.metric}"` });
      continue;
    }
    if (!config.dimensions.includes(ref as DimensionId)) {
      issues.push({
        level: 'warning',
        scope: `gate:${gate.id}`,
        message: `references dimension "${ref}" which is not in this run; gate will be reported N/A`,
      });
    }
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues, summary };
}

function parseGateMetric(metric: string): string | null {
  const [kind, rest] = metric.split(':', 2);
  if (!rest) return null;
  if (kind === 'dimension') return rest;
  if (kind === 'metric') {
    const dot = rest.indexOf('.');
    return dot < 0 ? null : rest.slice(0, dot);
  }
  return null;
}
