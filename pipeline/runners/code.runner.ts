import type { CodeCase, Dataset, DimensionResult, CaseResult } from '../../src/domain/types.ts';
import { mean, passAtK } from '../../src/domain/scoring.ts';
import { extractCodeBlock } from '../../src/shared/parse.ts';
import { runCodeTests } from '../../src/shared/code-sandbox.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/** Code generation (HumanEval-style): generate a function, run its tests. */
export const codeRunner: DimensionRunner = {
  id: 'code',
  method: 'objective',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as CodeCase[];
    const results: CaseResult[] = [];

    for (const c of cases) {
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
      results.push({
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
      });
    }

    const passRate = mean(results.map((r) => r.score));
    // With one sample per task, pass@1 equals the pass rate; expressed via the
    // estimator so the field is meaningful if sampling is increased later.
    const pass1 = passAtK(1, results.filter((r) => r.passed).length > 0 ? 1 : 0, 1) * passRate;
    return buildResult({
      dimensionId: 'code',
      group: ctx.groupFor('code'),
      method: 'objective',
      rawScore: passRate * 100,
      cases: results,
      metrics: {
        passAt1Pct: Math.round(passRate * 1000) / 10,
        sampledPass1: Math.round(pass1 * 1000) / 10,
      },
      dataset,
    });
  },
};
