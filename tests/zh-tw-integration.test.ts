import { describe, expect, it } from 'vitest';
import { DatasetLoader } from '../src/infrastructure/dataset-loader.ts';
import { categoryBreakdown } from '../pipeline/runners/mcq.ts';
import type { MultipleChoiceCase } from '../src/domain/types.ts';

describe('multi-file zh-tw loading (enterprise + TMMLU+ coexist)', () => {
  it('concatenates cases from both sources and combines versions', async () => {
    const loader = new DatasetLoader('datasets');
    const ds = await loader.load('zh-tw');
    // 30 enterprise + 24 bootstrap TMMLU+ placeholder.
    expect(ds.cases.length).toBeGreaterThanOrEqual(50);
    expect(ds.version).toContain('+');
    expect(ds.version).toContain('enterprise');
    expect(ds.version).toContain('tmmluplus');
    // Some cases carry a category, others (enterprise) do not.
    const withCat = ds.cases.filter((c) => (c as MultipleChoiceCase).category);
    expect(withCat.length).toBeGreaterThan(0);
  });
});

describe('categoryBreakdown', () => {
  it('computes per-category accuracy only for tagged cases', () => {
    const cases: MultipleChoiceCase[] = [
      { id: '1', kind: 'multiple-choice', question: 'q', choices: { A: 'a' }, answer: 'A', category: 'STEM' },
      { id: '2', kind: 'multiple-choice', question: 'q', choices: { A: 'a' }, answer: 'A', category: 'STEM' },
      { id: '3', kind: 'multiple-choice', question: 'q', choices: { A: 'a' }, answer: 'A', category: 'Humanities' },
      { id: '4', kind: 'multiple-choice', question: 'q', choices: { A: 'a' }, answer: 'A' }, // untagged
    ];
    const scores = [1, 0, 1, 1];
    const out = categoryBreakdown(cases, scores);
    expect(out.stemPct).toBe(50); // 1 of 2
    expect(out.humanitiesPct).toBe(100); // 1 of 1
    expect(out.socialSciPct).toBeUndefined();
  });
});
