#!/usr/bin/env tsx
/**
 * Ingest the TMMLU+ dataset (ikala/tmmluplus, MIT) into the project's zh-tw
 * format: a stratified sample across the four categories, tagged with
 * category + subject, written to datasets/zh-tw/tmmluplus.json.
 *
 * Run on a machine/environment whose network policy allows huggingface.co
 * (this benchmark's sandbox blocks it by default). Offline alternative: clone
 * the dataset first and pass --from.
 *
 *   pnpm ingest:tmmluplus                      # fetch from HuggingFace
 *   pnpm ingest:tmmluplus --total 200 --seed ai-benchmark-2026
 *   pnpm ingest:tmmluplus --from ./tmmluplus/data   # read local CSVs
 *
 * The result is committed JSON, so evaluation stays offline and reproducible.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  csvToRecords,
  recordToCase,
  SUBJECT_CATEGORY,
  stratifiedSelect,
} from '../src/infrastructure/tmmluplus.ts';
import type { Category, MultipleChoiceCase } from '../src/domain/types.ts';

const REPO = 'ikala/tmmluplus';

interface Args {
  total: number;
  seed: string;
  revision: string;
  from?: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith('--')) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        o[t.slice(2)] = next;
        i++;
      }
    }
  }
  return {
    total: o.total ? Number(o.total) : 200,
    seed: o.seed ?? 'ai-benchmark-2026',
    revision: o.revision ?? 'main',
    from: o.from,
    out: o.out ?? 'datasets/zh-tw/tmmluplus.json',
  };
}

async function discoverSubjects(args: Args): Promise<string[]> {
  if (args.from) {
    const files = await readdir(args.from);
    return files
      .filter((f) => f.endsWith('_test.csv'))
      .map((f) => f.slice(0, -'_test.csv'.length))
      .sort();
  }
  const url = `https://huggingface.co/api/datasets/${REPO}/tree/${args.revision}/data?recursive=false&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tree API ${res.status}: ${await res.text().catch(() => '')}`);
  const entries = (await res.json()) as { path: string; type: string }[];
  return entries
    .filter((e) => e.path.endsWith('_test.csv'))
    .map((e) => e.path.replace(/^data\//, '').replace(/_test\.csv$/, ''))
    .sort();
}

async function readCsv(subject: string, args: Args): Promise<string> {
  if (args.from) return readFile(join(args.from, `${subject}_test.csv`), 'utf8');
  const url = `https://huggingface.co/datasets/${REPO}/resolve/${args.revision}/data/${subject}_test.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV ${subject} ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.error(
    `Ingesting TMMLU+ (${REPO}@${args.revision}) → ${args.out}; target=${args.total}, seed=${args.seed}` +
      (args.from ? `, from=${args.from}` : ', via HuggingFace'),
  );

  const subjects = await discoverSubjects(args);
  console.error(`Discovered ${subjects.length} subjects.`);

  const unmapped = subjects.filter((s) => !(s in SUBJECT_CATEGORY));
  if (unmapped.length) {
    console.error(
      `⚠ ${unmapped.length} subject(s) not in the category map → defaulting to "Other": ${unmapped.join(', ')}`,
    );
  }

  const pool: MultipleChoiceCase[] = [];
  for (const subject of subjects) {
    try {
      const records = csvToRecords(await readCsv(subject, args));
      records.forEach((rec, i) => {
        const c = recordToCase(rec, subject, i);
        if (c) pool.push(c);
      });
    } catch (err) {
      console.error(`  ✗ ${subject}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.error(`Collected ${pool.length} usable questions from ${subjects.length} subjects.`);
  if (pool.length === 0) throw new Error('No questions collected; check network access or --from path.');

  const selected = stratifiedSelect(pool, (c) => c.category ?? 'Other', args.total, args.seed);

  const perCategory: Record<string, number> = {};
  const perSubject: Record<string, number> = {};
  for (const c of selected) {
    const cat = (c.category ?? 'Other') as Category;
    perCategory[cat] = (perCategory[cat] ?? 0) + 1;
    if (c.subject) perSubject[c.subject] = (perSubject[c.subject] ?? 0) + 1;
  }

  const output = {
    dimension: 'zh-tw',
    version: `tmmluplus-v1`,
    source: `${REPO}@${args.revision}`,
    license: 'MIT (ikala/tmmluplus)',
    citation: 'TMMLU+: An Improved Traditional Chinese Evaluation Suite (arXiv:2403.01858)',
    sampling: { total: selected.length, seed: args.seed, perCategory },
    manifest: { subjects: Object.keys(perSubject).length, perSubject },
    cases: selected,
  };

  await mkdir(args.out.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(args.out, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.error(
    `✓ Wrote ${selected.length} questions to ${args.out} — by category: ${JSON.stringify(perCategory)}`,
  );
  console.error('Next: pnpm benchmark:validate && pnpm test');
}

main().catch((err) => {
  console.error('Ingest failed:', err instanceof Error ? err.message : err);
  console.error(
    'If this is a network/allowlist error, run where huggingface.co is reachable, or use --from <localDir>.',
  );
  process.exitCode = 1;
});
