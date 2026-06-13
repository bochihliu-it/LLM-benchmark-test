import type { Dataset, DimensionResult } from '../../src/domain/types.ts';
import { evaluateMultipleChoice } from './mcq.ts';
import type { DimensionRunner, RunContext } from './runner.ts';

/** General knowledge & understanding (MMLU-style multiple choice). */
export const generalRunner: DimensionRunner = {
  id: 'general',
  method: 'objective',
  run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    return evaluateMultipleChoice(
      'general',
      dataset,
      ctx,
      'Answer the multiple-choice question. Reply with the single correct option letter.',
    );
  },
};
