/** Central registry mapping each dimension id to its runner. */
import type { DimensionId } from '../../src/domain/types.ts';
import type { DimensionRunner } from './runner.ts';
import { generalRunner } from './general.runner.ts';
import { reasoningRunner } from './reasoning.runner.ts';
import { codeRunner } from './code.runner.ts';
import { zhTwRunner } from './zh-tw.runner.ts';
import { ragRunner } from './rag.runner.ts';
import { toolUseRunner } from './tool-use.runner.ts';
import { safetyRunner } from './safety.runner.ts';
import { performanceRunner } from './performance.runner.ts';

export const RUNNERS: Record<DimensionId, DimensionRunner> = {
  general: generalRunner,
  reasoning: reasoningRunner,
  code: codeRunner,
  'zh-tw': zhTwRunner,
  rag: ragRunner,
  'tool-use': toolUseRunner,
  safety: safetyRunner,
  performance: performanceRunner,
};

export function getRunner(id: DimensionId): DimensionRunner {
  const runner = RUNNERS[id];
  if (!runner) throw new Error(`No runner registered for dimension "${id}"`);
  return runner;
}
