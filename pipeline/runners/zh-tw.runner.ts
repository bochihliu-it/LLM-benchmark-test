import type { Dataset, DimensionResult } from '../../src/domain/types.ts';
import { evaluateMultipleChoice } from './mcq.ts';
import type { DimensionRunner, RunContext } from './runner.ts';

/** Traditional Chinese capability (TMMLU+-style multiple choice). */
export const zhTwRunner: DimensionRunner = {
  id: 'zh-tw',
  method: 'objective',
  run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult> {
    return evaluateMultipleChoice(
      'zh-tw',
      dataset,
      ctx,
      '請回答以下選擇題，只需回覆正確選項的字母。',
    );
  },
};
