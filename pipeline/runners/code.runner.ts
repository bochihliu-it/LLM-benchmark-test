import type { CodeCase, Dataset, DimensionResult, CaseResult } from '../../src/domain/types.ts';
import { mean } from '../../src/domain/scoring.ts';
import { extractCodeBlock } from '../../src/shared/parse.ts';
import { runCodeTests } from '../../src/shared/code-sandbox.ts';
import { mapWithConcurrency } from '../../src/shared/async.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/** Code generation (HumanEval-style): generate a function, run its tests. */
export const codeRunner: DimensionRunner = {
  id: 'code',
  method: 'objective',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as CodeCase[];

    const results: CaseResult[] = await mapWithConcurrency(cases, ctx.concurrency, async (c) => {
      const res = await ctx.client.chat({
        messages: [
          {
            role: 'system',
            content:
              'You are a senior engineer. Implement the requested JavaScript function. ' +
              'Return only a single ```javascript code block with the full function.',
          },
          { role: 'user', content: `${c.prompt}\n\nImplement: function ${c.entrypoint}(...)` },
        ],
        temperature: 0,
        maxTokens: 512,
        mockOracle: { id: c.id, kind: 'code', solution: c.canonicalSolution },
      });
      const code = extractCodeBlock(res.content);
      const outcome = runCodeTests(code, c.entrypoint, c.tests);
      return {
        caseId: c.id,
        method: 'objective',
        score: outcome.passed ? 1 : 0,
        passed: outcome.passed,
        sampledForReview: ctx.sampleForReview(`code:${c.id}`),
        latency: res.latency,
        errored: res.errored ?? false,
        detail: `tests ${outcome.passedCount}/${outcome.total}${
          outcome.error ? ` (${outcome.error})` : ''
        }`,
      };
    });

    // One sample per task, so pass@1 is simply the pass rate. The passAtK
    // estimator in scoring.ts is ready if multi-sampling is added later.
    const passRate = mean(results.map((r) => r.score));
    return buildResult({
      dimensionId: 'code',
      group: ctx.groupFor('code'),
      method: 'objective',
      rawScore: passRate * 100,
      cases: results,
      metrics: { passAt1Pct: Math.round(passRate * 1000) / 10 },
      dataset,
    });
  },
};
