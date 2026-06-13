/**
 * Benchmark run configuration and its validation schema.
 *
 * A config points the harness at one or more models (always reached through the
 * LiteLLM OpenAI-compatible API in production), selects which dimensions to run,
 * pins the judge, and carries the weights and quality gates that turn raw
 * dimension scores into a single go/no-go decision.
 */
import { z } from 'zod';
import type { DimensionGroup, DimensionId } from './types.ts';

export const DIMENSION_IDS: DimensionId[] = [
  'general',
  'reasoning',
  'code',
  'zh-tw',
  'rag',
  'tool-use',
  'safety',
  'performance',
];

const dimensionIdSchema = z.enum([
  'general',
  'reasoning',
  'code',
  'zh-tw',
  'rag',
  'tool-use',
  'safety',
  'performance',
]);

/** Mock provider profile: lets the sample suite produce a believable spread. */
const mockProfileSchema = z.object({
  /** Probability the mock answers a scorable item correctly, in [0, 1]. */
  competence: z.number().min(0).max(1).default(0.75),
  /** Probability the mock safely refuses a red-team prompt; defaults to competence. */
  safetyRate: z.number().min(0).max(1).optional(),
  baseLatencyMs: z.number().positive().default(450),
  ttftMs: z.number().positive().default(220),
  tokensPerSec: z.number().positive().default(60),
  /** Simulated per-request error rate, in [0, 1]. */
  errorRate: z.number().min(0).max(1).default(0.0),
});

export type MockProfile = z.infer<typeof mockProfileSchema>;

const modelSchema = z.object({
  /** LiteLLM model name, e.g. "llama-3.3-70b-instruct". */
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(['litellm', 'mock']).default('litellm'),
  params: z.string().optional(),
  quantization: z.string().optional(),
  /** Estimated VRAM footprint (GB) used in efficiency ranking. */
  vramGb: z.number().positive().optional(),
  mock: mockProfileSchema.optional(),
});

export type ModelConfig = z.infer<typeof modelSchema>;

const judgeSchema = z.object({
  provider: z.enum(['litellm', 'mock']).default('litellm'),
  model: z.string().default('judge-default'),
  version: z.string().default('v1'),
  temperature: z.number().min(0).max(2).default(0),
});

const litellmSchema = z.object({
  baseUrl: z.string().default('http://localhost:4000'),
  /** Read from this env var at runtime; never inline secrets in config. */
  apiKeyEnv: z.string().default('LITELLM_API_KEY'),
  timeoutMs: z.number().positive().default(120_000),
  maxRetries: z.number().int().min(0).default(2),
  stream: z.boolean().default(true),
});

const gateSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Path into the result, e.g. "dimension:zh-tw" or "metric:performance.p95TtftMs". */
  metric: z.string(),
  comparator: z.enum(['>=', '<=', '<', '>']),
  threshold: z.number(),
  /**
   * blocking — a failure blocks go-live (counts against gatesPassed).
   * warning  — a failure is surfaced for review but does not block.
   */
  severity: z.enum(['blocking', 'warning']).default('blocking'),
});

export type GateConfig = z.infer<typeof gateSchema>;

const groupKeys: [DimensionGroup, ...DimensionGroup[]] = [
  'capability',
  'application',
  'reliability-safety',
  'performance-cost',
];

export const benchmarkConfigSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().default('benchmark-run'),
  seed: z.string().default('ai-benchmark-2026'),
  /** Max in-flight requests per dimension. Higher = faster real runs. */
  concurrency: z.number().int().min(1).max(64).default(4),
  models: z.array(modelSchema).min(1),
  dimensions: z.array(dimensionIdSchema).min(1),
  judge: judgeSchema.default({}),
  litellm: litellmSchema.default({}),
  /** Fraction of cases per dimension drawn for human review, in [0, 1]. */
  humanReviewSampleRate: z.number().min(0).max(1).default(0.1),
  /** Overall score (0-100) at/above which a gate-passing model is "go-live". */
  goLiveThreshold: z.number().min(0).max(100).default(75),
  weights: z
    .object({
      capability: z.number().min(0),
      application: z.number().min(0),
      'reliability-safety': z.number().min(0),
      'performance-cost': z.number().min(0),
    })
    .default({
      capability: 0.4,
      application: 0.25,
      'reliability-safety': 0.15,
      'performance-cost': 0.2,
    }),
  /** Maps each dimension into a decision-matrix group. */
  groups: z
    .record(dimensionIdSchema, z.enum(groupKeys))
    .default({
      general: 'capability',
      reasoning: 'capability',
      code: 'capability',
      'zh-tw': 'capability',
      rag: 'application',
      'tool-use': 'application',
      safety: 'reliability-safety',
      performance: 'performance-cost',
    }),
  gates: z.array(gateSchema).default([]),
  /** Dataset directory root. */
  datasetsDir: z.string().default('datasets'),
  /** Where result JSON is written. */
  resultsDir: z.string().default('results'),
});

export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;

export function parseConfig(raw: unknown): BenchmarkConfig {
  return benchmarkConfigSchema.parse(raw);
}
