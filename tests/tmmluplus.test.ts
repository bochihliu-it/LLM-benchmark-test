import { describe, expect, it } from 'vitest';
import {
  categoryForSubject,
  csvToRecords,
  parseCsv,
  recordToCase,
  seededShuffle,
  stratifiedSelect,
} from '../src/infrastructure/tmmluplus.ts';
import type { Category } from '../src/domain/types.ts';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('"x,y",z\n"q""q",w')).toEqual([
      ['x,y', 'z'],
      ['q"q', 'w'],
    ]);
  });
  it('handles newlines inside quotes', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });
});

describe('csvToRecords + recordToCase', () => {
  const csv = 'question,A,B,C,D,answer\n"2+2=?","3","4","5","6","B"';
  it('maps a TMMLU+ row to a MultipleChoiceCase', () => {
    const recs = csvToRecords(csv);
    expect(recs[0]!.question).toBe('2+2=?');
    const c = recordToCase(recs[0]!, 'computer_science', 0);
    expect(c).not.toBeNull();
    expect(c!.answer).toBe('B');
    expect(c!.choices).toEqual({ A: '3', B: '4', C: '5', D: '6' });
    expect(c!.category).toBe('STEM');
    expect(c!.subject).toBe('computer_science');
    expect(c!.id).toBe('tmmluplus:computer_science:0');
  });
  it('rejects a row whose answer letter has no choice', () => {
    const rec = { question: 'q', A: 'x', answer: 'D' };
    expect(recordToCase(rec, 'physics', 1)).toBeNull();
  });
});

describe('categoryForSubject', () => {
  it('maps known subjects and defaults unknown to Other', () => {
    expect(categoryForSubject('computer_science')).toBe('STEM');
    expect(categoryForSubject('macroeconomics')).toBe('Social Sciences');
    expect(categoryForSubject('music')).toBe('Humanities');
    expect(categoryForSubject('totally_unknown_subject')).toBe('Other');
  });
});

describe('seededShuffle', () => {
  it('is deterministic and preserves the multiset', () => {
    const a = seededShuffle([1, 2, 3, 4, 5], 's');
    const b = seededShuffle([1, 2, 3, 4, 5], 's');
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(seededShuffle([1, 2, 3, 4, 5], 'other')).not.toEqual(a);
  });
});

describe('stratifiedSelect', () => {
  const pool = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `stem${i}`, cat: 'STEM' as Category })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `hum${i}`, cat: 'Humanities' as Category })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `soc${i}`, cat: 'Social Sciences' as Category })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `oth${i}`, cat: 'Other' as Category })),
  ];

  it('selects the target total, evenly across categories, deterministically', () => {
    const a = stratifiedSelect(pool, (x) => x.cat, 40, 'seed');
    const b = stratifiedSelect(pool, (x) => x.cat, 40, 'seed');
    expect(a).toEqual(b);
    expect(a).toHaveLength(40);
    const counts = a.reduce<Record<string, number>>((m, x) => {
      m[x.cat] = (m[x.cat] ?? 0) + 1;
      return m;
    }, {});
    expect(counts).toEqual({ STEM: 10, Humanities: 10, 'Social Sciences': 10, Other: 10 });
  });

  it('redistributes when a category is too small to meet its quota', () => {
    const skewed = [
      { id: 'a', cat: 'STEM' as Category },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, cat: 'Humanities' as Category })),
    ];
    const out = stratifiedSelect(skewed, (x) => x.cat, 20, 'seed');
    expect(out).toHaveLength(20); // shortfall in STEM filled from Humanities
  });
});
