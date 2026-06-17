/**
 * Persists benchmark results as versioned JSON. Results are the durable record
 * the leaderboard and proposals are built from, so the on-disk shape is the
 * BenchmarkResult document verbatim.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkResult } from '../domain/types.ts';

export class ResultStore {
  constructor(private readonly dir: string) {}

  async save(result: BenchmarkResult): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const safeModel = result.model.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const stamp = result.startedAt.replace(/[:.]/g, '-');
    const file = join(this.dir, `${safeModel}__${stamp}.json`);
    await writeFile(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
    return file;
  }

  async loadAll(): Promise<BenchmarkResult[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const results: BenchmarkResult[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const content = await readFile(join(this.dir, entry), 'utf8');
        results.push(JSON.parse(content) as BenchmarkResult);
      } catch {
        // skip unreadable / partial files
      }
    }
    return results;
  }
}
