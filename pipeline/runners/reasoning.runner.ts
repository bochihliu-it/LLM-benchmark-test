import type {
  CaseResult,
  Dataset,
  DimensionResult,
  NumericCase,
} from '../../src/domain/types.ts';
import { extractNumber, mean, numericMatch } from '../../src/domain/scoring.ts';
import { mapWithConcurrency } from '../../src/shared/async.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/** Multi-step reasoning & math (GSM8K-style numeric answers). */
export const reasoningRunner: DimensionRunner = {
  id: 'reasoning',
  method: 'objective',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as NumericCase[];

    const results: CaseResult[] = await mapWithConcurrency(cases, ctx.concurrency, async (c) => {
      const res = await ctx.client.chat({
        messages: [
          {
            role: 'system',
            content:
              'Solve the problem. Think step by step, then end with a line "Answer: <number>".',
          },
          { role: 'user', content: c.question },
        ],
        temperature: 0,
        maxTokens: 512,
        mockOracle: { id: c.id, kind: 'numeric', answer: c.answer },
      });
      const predicted = extractFinalNumber(res.content);
      const passed = numericMatch(predicted, c.answer, c.tolerance ?? 1e-6);
      return {
        caseId: c.id,
        method: 'objective',
        score: passed ? 1 : 0,
        passed,
        sampledForReview: ctx.sampleForReview(`reasoning:${c.id}`),
        latency: res.latency,
        errored: res.errored ?? false,
        detail: `predicted=${predicted ?? '∅'} expected=${c.answer}`,
      };
    });

    const accuracy = mean(results.map((r) => r.score));
    return buildResult({
      dimensionId: 'reasoning',
      group: ctx.groupFor('reasoning'),
      method: 'objective',
      rawScore: accuracy * 100,
      cases: results,
      metrics: { accuracyPct: Math.round(accuracy * 1000) / 10 },
      dataset,
    });
  },
};

/** Prefer the number after an "Answer:" marker; fall back to the last number. */
function extractFinalNumber(text: string): number | null {
  const marked = text.match(/answer\s*:?\s*\$?\s*(-?\d[\d,]*(?:\.\d+)?)/i);
  if (marked) return extractNumber(marked[1]!);
  const all = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (!all || all.length === 0) return null;
  return Number.parseFloat(all[all.length - 1]!);
}
