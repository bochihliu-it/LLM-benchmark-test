import type {
  CaseResult,
  Dataset,
  DimensionResult,
  ToolUseCase,
} from '../../src/domain/types.ts';
import { mean } from '../../src/domain/scoring.ts';
import { tryParseJson } from '../../src/shared/parse.ts';
import { mapWithConcurrency } from '../../src/shared/async.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/**
 * Tool calling / structured output (BFCL-style). The model must emit a function
 * call whose JSON arguments include the required fields and match any expected
 * values. Scored objectively as the mean of valid-JSON, required-coverage, and
 * expected-match sub-scores.
 */
export const toolUseRunner: DimensionRunner = {
  id: 'tool-use',
  method: 'objective',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as ToolUseCase[];

    const results: CaseResult[] = await mapWithConcurrency(cases, ctx.concurrency, async (c) => {
      const res = await ctx.client.chat({
        messages: [
          { role: 'system', content: 'Call the provided tool with correct arguments.' },
          { role: 'user', content: c.prompt },
        ],
        temperature: 0,
        tools: [c.tool],
        toolChoice: c.tool.name,
        mockOracle: {
          id: c.id,
          kind: 'tool',
          toolName: c.tool.name,
          args: buildOracleArgs(c),
        },
      });

      const { score, detail } = scoreToolCall(c, res.toolCall?.arguments, res.toolCall?.name);
      return {
        caseId: c.id,
        method: 'objective',
        score,
        passed: score >= 0.999,
        sampledForReview: ctx.sampleForReview(`tool-use:${c.id}`),
        latency: res.latency,
        errored: res.errored ?? false,
        detail,
      };
    });

    const avg = mean(results.map((r) => r.score));
    const fullPass = mean(results.map((r) => (r.passed ? 1 : 0)));
    return buildResult({
      dimensionId: 'tool-use',
      group: ctx.groupFor('tool-use'),
      method: 'objective',
      rawScore: avg * 100,
      cases: results,
      metrics: {
        meanScorePct: Math.round(avg * 1000) / 10,
        exactCallPct: Math.round(fullPass * 1000) / 10,
      },
      dataset,
    });
  },
};

function buildOracleArgs(c: ToolUseCase): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of c.requiredArgs) {
    args[key] = c.expectedArgs?.[key] ?? `value_${key}`;
  }
  if (c.expectedArgs) Object.assign(args, c.expectedArgs);
  return args;
}

function scoreToolCall(
  c: ToolUseCase,
  rawArgs: string | undefined,
  name: string | undefined,
): { score: number; detail: string } {
  if (!rawArgs || name !== c.tool.name) {
    return { score: 0, detail: `no valid tool call (got ${name ?? '∅'})` };
  }
  const parsed = tryParseJson(rawArgs);
  if (parsed === null || typeof parsed !== 'object') {
    return { score: 0, detail: 'arguments were not valid JSON' };
  }
  const obj = parsed as Record<string, unknown>;

  const jsonScore = 1;
  const requiredHit = c.requiredArgs.filter((k) => k in obj).length;
  const requiredScore = c.requiredArgs.length ? requiredHit / c.requiredArgs.length : 1;

  let expectedScore = 1;
  if (c.expectedArgs) {
    const keys = Object.keys(c.expectedArgs);
    const hit = keys.filter((k) => String(obj[k]) === String(c.expectedArgs![k])).length;
    expectedScore = keys.length ? hit / keys.length : 1;
  }

  const score = (jsonScore + requiredScore + expectedScore) / 3;
  return {
    score: Math.round(score * 1000) / 1000,
    detail: `json=ok required=${requiredHit}/${c.requiredArgs.length} expected=${Math.round(
      expectedScore * 100,
    )}%`,
  };
}
