import type { CaseResult, Dataset, DimensionResult, PerfCase } from '../../src/domain/types.ts';
import { aggregateLatency, performanceScore } from '../../src/domain/scoring.ts';
import { buildResult, type DimensionRunner, type RunContext } from './runner.ts';

/**
 * Performance & cost. Runs representative prompts and measures TTFT/TPOT,
 * throughput, and error rate. The dimension score is a soft blend against
 * targets; the raw percentiles feed the latency and stability quality gates.
 *
 * This in-process pass is a smoke measurement — true concurrency/throughput
 * testing is delegated to the k6 / vllm-bench scripts under perf/.
 */
export const performanceRunner: DimensionRunner = {
  id: 'performance',
  method: 'performance',
  async run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    const cases = dataset.cases as PerfCase[];
    const results: CaseResult[] = [];
    let totalCompletionTokens = 0;
    let totalGenMs = 0;
    let errors = 0;

    // Intentionally sequential (ignores ctx.concurrency): this in-process pass
    // measures clean per-request latency. Concurrency/throughput under load is
    // the job of the k6 / vllm-bench scripts under perf/.
    for (const c of cases) {
      const res = await ctx.client.chat({
        messages: [{ role: 'user', content: c.prompt }],
        temperature: 0,
        maxTokens: c.maxTokens,
        mockOracle: { id: c.id, kind: 'perf' },
      });
      if (res.errored) errors++;
      totalCompletionTokens += res.usage.completionTokens;
      totalGenMs += Math.max(res.latency.totalMs - res.latency.ttftMs, 0);
      results.push({
        caseId: c.id,
        method: 'performance',
        score: res.errored ? 0 : 1,
        passed: !res.errored,
        sampledForReview: false,
        latency: res.latency,
        errored: res.errored ?? false,
        detail: `ttft=${res.latency.ttftMs}ms total=${res.latency.totalMs}ms tokens=${res.usage.completionTokens}`,
      });
    }

    const lat = aggregateLatency(results.map((r) => r.latency));
    const tokensPerSec =
      totalGenMs > 0 ? Math.round((totalCompletionTokens / totalGenMs) * 1000) : 0;
    const errorRate = results.length ? errors / results.length : 0;
    const score = performanceScore({
      p95TtftMs: lat.p95TtftMs,
      tpotMs: lat.meanTpotMs,
      tokensPerSec,
      errorRate,
    });

    return buildResult({
      dimensionId: 'performance',
      group: ctx.groupFor('performance'),
      method: 'performance',
      rawScore: score,
      cases: results,
      metrics: {
        p50TtftMs: lat.p50TtftMs,
        p95TtftMs: lat.p95TtftMs,
        meanTotalMs: lat.meanTotalMs,
        meanTpotMs: lat.meanTpotMs,
        tokensPerSec,
        errorRatePct: Math.round(errorRate * 1000) / 10,
      },
      dataset,
    });
  },
};
