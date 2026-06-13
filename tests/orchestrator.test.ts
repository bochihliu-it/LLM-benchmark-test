import { describe, expect, it } from 'vitest';
import { parseConfig, type ModelConfig } from '../src/domain/config.ts';
import { runModel } from '../src/application/orchestrator.ts';
import { MockClient } from '../src/infrastructure/mock-client.ts';
import { MockJudge } from '../src/application/judge.ts';
import { DatasetLoader } from '../src/infrastructure/dataset-loader.ts';
import { createLogger } from '../src/infrastructure/logger.ts';

const config = parseConfig({
  name: 'test-run',
  seed: 'unit-seed',
  models: [{ id: 'm', label: 'M', provider: 'mock' }],
  dimensions: ['general', 'reasoning', 'code', 'zh-tw', 'rag', 'tool-use', 'safety', 'performance'],
  judge: { provider: 'mock' },
  gates: [
    { id: 'g-zh', label: 'zh', metric: 'dimension:zh-tw', comparator: '>=', threshold: 70 },
    { id: 'g-ttft', label: 'ttft', metric: 'metric:performance.p95TtftMs', comparator: '<', threshold: 2000 },
  ],
});

const model: ModelConfig = {
  id: 'test-model',
  label: 'Test Model',
  provider: 'mock',
  vramGb: 16,
  mock: { competence: 0.85, ttftMs: 150, tokensPerSec: 90, errorRate: 0 },
};

function deps() {
  return {
    config,
    loader: new DatasetLoader('datasets'),
    judge: new MockJudge(),
    logger: createLogger('error'),
  };
}

describe('orchestrator (all dimensions together)', () => {
  it('runs every enabled dimension in one pass', async () => {
    const client = new MockClient(model.id, model.mock, config.seed);
    const result = await runModel(model, client, deps());

    expect(result.dimensions.map((d) => d.dimensionId).sort()).toEqual(
      ['code', 'general', 'performance', 'rag', 'reasoning', 'safety', 'tool-use', 'zh-tw'],
    );
    for (const d of result.dimensions) {
      expect(d.rawScore).toBeGreaterThanOrEqual(0);
      expect(d.rawScore).toBeLessThanOrEqual(100);
      expect(d.datasetChecksum).not.toBe('unknown');
    }
    expect(result.aggregate.overall).toBeGreaterThan(0);
    expect(result.aggregate.gates.length).toBe(2);
    expect(result.environment.judgeModel).toBe('mock-judge');
  });

  it('is reproducible: two runs with the same seed are identical', async () => {
    const a = await runModel(model, new MockClient(model.id, model.mock, config.seed), deps());
    const b = await runModel(model, new MockClient(model.id, model.mock, config.seed), deps());

    expect(b.aggregate.overall).toBe(a.aggregate.overall);
    expect(b.aggregate.perDimension).toEqual(a.aggregate.perDimension);
  });

  it('a higher-competence model scores higher overall', async () => {
    const weak: ModelConfig = { ...model, id: 'weak', mock: { ...model.mock!, competence: 0.4 } };
    const strong: ModelConfig = { ...model, id: 'strong', mock: { ...model.mock!, competence: 0.95 } };

    const weakRes = await runModel(weak, new MockClient(weak.id, weak.mock, config.seed), deps());
    const strongRes = await runModel(strong, new MockClient(strong.id, strong.mock, config.seed), deps());

    expect(strongRes.aggregate.overall).toBeGreaterThan(weakRes.aggregate.overall);
  });
});
