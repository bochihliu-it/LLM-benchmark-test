import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/domain/config.ts';
import { applyOverrides, parseList } from '../src/cli/overrides.ts';

function base() {
  return parseConfig({
    name: 'ovr',
    models: [
      { id: 'a', label: 'A', provider: 'mock' },
      { id: 'b', label: 'B', provider: 'mock' },
    ],
    dimensions: ['general', 'code', 'safety'],
    judge: { provider: 'mock' },
  });
}

describe('parseList', () => {
  it('splits on commas and whitespace, trimming empties', () => {
    expect(parseList('general, code ,safety')).toEqual(['general', 'code', 'safety']);
    expect(parseList(undefined)).toBeUndefined();
    expect(parseList('')).toEqual([]);
  });
});

describe('applyOverrides', () => {
  it('overrides scalar fields without mutating the input', () => {
    const cfg = base();
    const out = applyOverrides(cfg, { seed: 'x', concurrency: 8, goLiveThreshold: 80 });
    expect(out.seed).toBe('x');
    expect(out.concurrency).toBe(8);
    expect(out.goLiveThreshold).toBe(80);
    expect(cfg.seed).toBe('ai-benchmark-2026'); // original untouched
  });

  it('filters dimensions to a valid subset', () => {
    const out = applyOverrides(base(), { dimensions: ['general', 'safety'] });
    expect(out.dimensions).toEqual(['general', 'safety']);
  });

  it('rejects unknown dimensions', () => {
    expect(() => applyOverrides(base(), { dimensions: ['general', 'bogus'] })).toThrow(/unknown/);
  });

  it('filters models by id', () => {
    const out = applyOverrides(base(), { models: ['b'] });
    expect(out.models.map((m) => m.id)).toEqual(['b']);
  });

  it('throws when a model filter matches nothing', () => {
    expect(() => applyOverrides(base(), { models: ['zzz'] })).toThrow(/matched none/);
  });

  it('rejects a non-positive concurrency', () => {
    expect(() => applyOverrides(base(), { concurrency: 0 })).toThrow(/positive/);
  });
});
