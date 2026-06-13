/**
 * Loads dimension datasets from disk and stamps each with a content checksum so
 * results can record exactly which question set produced them (reproducibility).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dataset, DimensionId, TaskCase } from '../domain/types.ts';

/** Canonical dataset file for each dimension. */
export const DATASET_FILES: Record<DimensionId, string> = {
  general: 'general/mmlu-sample.json',
  reasoning: 'reasoning/gsm8k-sample.json',
  code: 'code/humaneval-sample.json',
  'zh-tw': 'zh-tw/tmmlu-sample.json',
  rag: 'rag/faithfulness-sample.json',
  'tool-use': 'tool-use/function-call-sample.json',
  safety: 'redteam/safety-sample.json',
  performance: 'performance/load-sample.json',
};

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export class DatasetLoader {
  constructor(private readonly rootDir: string) {}

  async load(dimension: DimensionId): Promise<Dataset> {
    const rel = DATASET_FILES[dimension];
    const path = join(this.rootDir, rel);
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read dataset for "${dimension}" at ${path}: ${String(err)}`);
    }

    let parsed: Dataset;
    try {
      parsed = JSON.parse(content) as Dataset;
    } catch (err) {
      throw new Error(`Dataset for "${dimension}" is not valid JSON (${path}): ${String(err)}`);
    }

    if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
      throw new Error(`Dataset for "${dimension}" has no cases (${path}).`);
    }

    return {
      dimension,
      version: parsed.version ?? 'unversioned',
      checksum: checksum(content),
      cases: parsed.cases as TaskCase[],
    };
  }
}
