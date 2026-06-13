import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/domain/config.ts';
import { validateConfig } from '../src/application/validate.ts';

const base = {
  models: [{ id: 'm', label: 'M', provider: 'mock' as const }],
  dimensions: ['general', 'reasoning', 'rag'],
  judge: { provider: 'mock' as const },
};

describe('validateConfig', () => {
  it('passes for the real sample datasets', async () => {
    const report = await validateConfig(parseConfig({ ...base, datasetsDir: 'datasets' }));
    expect(report.ok).toBe(true);
    expect(report.summary.length).toBe(3);
    expect(report.summary.every((s) => s.cases > 0)).toBe(true);
  });

  it('errors when the datasets directory is missing', async () => {
    const report = await validateConfig(parseConfig({ ...base, datasetsDir: 'does-not-exist' }));
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('warns when a gate references a dimension not in the run', async () => {
    const report = await validateConfig(
      parseConfig({
        ...base,
        datasetsDir: 'datasets',
        gates: [
          { id: 'g', label: 'code gate', metric: 'dimension:code', comparator: '>=', threshold: 50 },
        ],
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.level === 'warning' && i.scope === 'gate:g')).toBe(true);
  });
});
