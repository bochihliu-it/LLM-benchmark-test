/**
 * Builds model and judge clients from configuration. Centralizing this keeps the
 * mock/real decision in one place and ensures secrets only ever come from the
 * environment, never from the config file.
 */
import type { BenchmarkConfig, ModelConfig } from '../domain/config.ts';
import type { ModelClient } from '../domain/types.ts';
import { LiteLlmClient } from './litellm-client.ts';
import { MockClient } from './mock-client.ts';
import { LlmJudge, MockJudge, type Judge } from '../application/judge.ts';
import type { Logger } from './logger.ts';

export function createModelClient(
  model: ModelConfig,
  config: BenchmarkConfig,
  logger: Logger,
): ModelClient {
  if (model.provider === 'mock') {
    return new MockClient(model.id, model.mock, config.seed);
  }
  const apiKey = process.env[config.litellm.apiKeyEnv] ?? '';
  if (!apiKey) {
    logger.warn(
      `No API key in env var ${config.litellm.apiKeyEnv}; LiteLLM calls may be rejected.`,
    );
  }
  return new LiteLlmClient({
    baseUrl: config.litellm.baseUrl,
    apiKey,
    model: model.id,
    timeoutMs: config.litellm.timeoutMs,
    maxRetries: config.litellm.maxRetries,
    stream: config.litellm.stream,
    logger,
  });
}

export function createJudge(config: BenchmarkConfig, logger: Logger): Judge {
  if (config.judge.provider === 'mock') {
    return new MockJudge(config.judge.model, config.judge.version);
  }
  const apiKey = process.env[config.litellm.apiKeyEnv] ?? '';
  const client = new LiteLlmClient({
    baseUrl: config.litellm.baseUrl,
    apiKey,
    model: config.judge.model,
    timeoutMs: config.litellm.timeoutMs,
    maxRetries: config.litellm.maxRetries,
    stream: false,
    logger,
  });
  return new LlmJudge(client, config.judge.version, logger);
}
