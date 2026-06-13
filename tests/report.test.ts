import { describe, expect, it } from 'vitest';
import { latestPerModel, renderLeaderboard } from '../src/application/report-writer.ts';
import type { BenchmarkResult } from '../src/domain/types.ts';

function result(id: string, startedAt: string, overall: number): BenchmarkResult {
  return {
    runId: `${id}-${startedAt}`,
    startedAt,
    finishedAt: startedAt,
    model: { id, provider: 'mock', label: id, vramGb: 16 },
    environment: {
      harnessVersion: '0.1.0',
      node: 'v22',
      seed: 's',
      judgeModel: 'mock-judge',
      judgeVersion: 'v1',
      litellmBaseUrl: 'mock://offline',
    },
    dimensions: [],
    aggregate: {
      overall,
      groups: {
        capability: { weight: 0.4, score: overall },
        application: { weight: 0.25, score: overall },
        'reliability-safety': { weight: 0.15, score: overall },
        'performance-cost': { weight: 0.2, score: overall },
      },
      perDimension: { general: overall },
      gates: [],
      gatesPassed: true,
    },
  };
}

describe('latestPerModel', () => {
  it('keeps only the most recent run per model id', () => {
    const all = [
      result('a', '2026-06-01T00:00:00Z', 50),
      result('a', '2026-06-02T00:00:00Z', 80),
      result('b', '2026-06-01T00:00:00Z', 70),
    ];
    const latest = latestPerModel(all);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.model.id === 'a')!.aggregate.overall).toBe(80);
  });
});

describe('renderLeaderboard', () => {
  it('sorts by overall and dedupes', () => {
    const md = renderLeaderboard([
      result('a', '2026-06-01T00:00:00Z', 50),
      result('a', '2026-06-02T00:00:00Z', 90),
      result('b', '2026-06-01T00:00:00Z', 70),
    ]);
    const firstRow = md.indexOf('| 1 |');
    const secondRow = md.indexOf('| 2 |');
    expect(md.slice(firstRow, secondRow)).toContain('90');
    // a appears once despite two runs
    expect(md.match(/\| a \|/g)?.length).toBe(1);
  });
});
