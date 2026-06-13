/**
 * Shared multiple-choice evaluation used by both the general-knowledge and
 * Traditional-Chinese dimensions. Objective, exact-match scoring with the choice
 * letter parsed from the model's reply.
 */
import type {
  CaseResult,
  Dataset,
  DimensionId,
  DimensionResult,
  MultipleChoiceCase,
} from '../../src/domain/types.ts';
import { mean } from '../../src/domain/scoring.ts';
import { extractChoiceLetter } from '../../src/shared/parse.ts';
import { mapWithConcurrency } from '../../src/shared/async.ts';
import { buildResult, type RunContext } from './runner.ts';

export async function evaluateMultipleChoice(
  dimensionId: DimensionId,
  dataset: Dataset,
  ctx: RunContext,
  instruction: string,
): Promise<DimensionResult> {
  const cases = dataset.cases as MultipleChoiceCase[];

  const results: CaseResult[] = await mapWithConcurrency(cases, ctx.concurrency, async (c) => {
    const choiceKeys = Object.keys(c.choices);
    const rendered = choiceKeys.map((k) => `${k}. ${c.choices[k]}`).join('\n');
    const res = await ctx.client.chat({
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: `${c.question}\n\n${rendered}` },
      ],
      temperature: 0,
      maxTokens: 64,
      mockOracle: { id: c.id, kind: 'choice', correct: c.answer },
    });
    const picked = extractChoiceLetter(res.content, choiceKeys);
    const passed = picked !== null && picked.toUpperCase() === c.answer.toUpperCase();
    return {
      caseId: c.id,
      method: 'objective',
      score: passed ? 1 : 0,
      passed,
      sampledForReview: ctx.sampleForReview(`${dimensionId}:${c.id}`),
      latency: res.latency,
      errored: res.errored ?? false,
      detail: `picked=${picked ?? '∅'} expected=${c.answer}`,
    };
  });

  const accuracy = mean(results.map((r) => r.score));
  return buildResult({
    dimensionId,
    group: ctx.groupFor(dimensionId),
    method: 'objective',
    rawScore: accuracy * 100,
    cases: results,
    metrics: { accuracyPct: Math.round(accuracy * 1000) / 10 },
    dataset,
  });
}
