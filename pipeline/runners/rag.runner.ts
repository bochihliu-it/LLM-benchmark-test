import type { CaseResult, Dataset, DimensionResult, JudgeCase } from '../../src/domain/types.ts';
import { mean } from '../../src/domain/scoring.ts';
import { mapWithConcurrency } from '../../src/shared/async.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/**
 * RAG fitness (faithfulness). The model answers strictly from retrieved context;
 * the pinned judge scores faithfulness/groundedness against that context — this
 * is the LLM-as-Judge layer of the three-layer method.
 */
export const ragRunner: DimensionRunner = {
  id: 'rag',
  method: 'judge',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as JudgeCase[];

    const results: CaseResult[] = await mapWithConcurrency(cases, ctx.concurrency, async (c) => {
      const maxPerCriterion = c.maxPerCriterion ?? 5;
      const userContent = c.context
        ? `Context:\n${c.context}\n\nQuestion: ${c.prompt}\n\nAnswer using only the context.`
        : c.prompt;
      const res = await ctx.client.chat({
        messages: [
          {
            role: 'system',
            content:
              'Answer strictly from the provided context. If the context does not ' +
              'contain the answer, say so. Do not invent facts.',
          },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        maxTokens: 512,
        mockOracle: { id: c.id, kind: 'judge', reference: c.referenceAnswer ?? c.context ?? '' },
      });

      const verdict = await ctx.judge.score({
        prompt: c.prompt,
        answer: res.content,
        rubric: c.rubric,
        reference: c.referenceAnswer,
        context: c.context,
        maxPerCriterion,
        seedKey: `${ctx.client.id}:rag:${c.id}`,
      });

      const passed = verdict.score >= 0.6;
      return {
        caseId: c.id,
        method: 'judge',
        score: verdict.score,
        passed,
        sampledForReview: ctx.sampleForReview(`rag:${c.id}`),
        latency: res.latency,
        errored: res.errored ?? false,
        detail: `judge=${(verdict.score * 100).toFixed(0)}% (${verdict.rationale})`,
      };
    });

    const avg = mean(results.map((r) => r.score));
    return buildResult({
      dimensionId: 'rag',
      group: ctx.groupFor('rag'),
      method: 'judge',
      rawScore: avg * 100,
      cases: results,
      metrics: { faithfulnessPct: Math.round(avg * 1000) / 10 },
      dataset,
    });
  },
};
