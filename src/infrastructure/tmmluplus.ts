/**
 * Pure helpers for ingesting the TMMLU+ dataset (ikala/tmmluplus, MIT licensed)
 * into the project's multiple-choice format. No IO here — the CLI script in
 * scripts/ingest-tmmluplus.ts does the network/file work and calls these.
 *
 * TMMLU+ rows have columns: question, A, B, C, D, answer (answer is a letter).
 * Its 66 subjects roll up into four categories: STEM, Humanities,
 * Social Sciences, Other.
 */
import type { Category, MultipleChoiceCase } from '../domain/types.ts';
import { hashSeed, mulberry32 } from '../shared/rng.ts';

/**
 * Best-effort subject → category map for the TMMLU+ taxonomy. Unmapped subjects
 * fall back to "Other" (the ingest script logs them). Edit to match the paper's
 * exact grouping if needed; category sub-scores are an internal aid.
 */
export const SUBJECT_CATEGORY: Record<string, Category> = {
  // --- STEM ---
  engineering_math: 'STEM',
  advance_chemistry: 'STEM',
  organic_chemistry: 'STEM',
  physics: 'STEM',
  secondary_physics: 'STEM',
  junior_science_exam: 'STEM',
  junior_math_exam: 'STEM',
  junior_chemistry: 'STEM',
  statistics_and_machine_learning: 'STEM',
  computer_science: 'STEM',
  tve_mathematics: 'STEM',
  tve_natural_sciences: 'STEM',
  mechanical: 'STEM',
  pharmacology: 'STEM',
  pharmacy: 'STEM',
  dentistry: 'STEM',
  veterinary_pathology: 'STEM',
  traditional_chinese_medicine_clinical_medicine: 'STEM',
  optometry: 'STEM',
  fire_science: 'STEM',
  clinical_psychology: 'STEM',
  // --- Humanities ---
  chinese_language_and_literature: 'Humanities',
  junior_chinese_exam: 'Humanities',
  tve_chinese_language: 'Humanities',
  music: 'Humanities',
  three_principles_of_people: 'Humanities',
  taiwanese_hokkien: 'Humanities',
  general_principles_of_law: 'Humanities',
  introduction_to_law: 'Humanities',
  jce_humanities: 'Humanities',
  // --- Social Sciences ---
  macroeconomics: 'Social Sciences',
  finance_banking: 'Social Sciences',
  financial_analysis: 'Social Sciences',
  accounting: 'Social Sciences',
  management_accounting: 'Social Sciences',
  business_management: 'Social Sciences',
  marketing_management: 'Social Sciences',
  politic_science: 'Social Sciences',
  geography_of_taiwan: 'Social Sciences',
  human_behavior: 'Social Sciences',
  educational_psychology: 'Social Sciences',
  education: 'Social Sciences',
  national_protection: 'Social Sciences',
  insurance_studies: 'Social Sciences',
  taxation: 'Social Sciences',
  trade: 'Social Sciences',
  real_estate: 'Social Sciences',
  trust_practice: 'Social Sciences',
  anti_money_laundering: 'Social Sciences',
  junior_social_studies: 'Social Sciences',
  // --- Other ---
  technical: 'Other',
  culinary_skills: 'Other',
  logic_reasoning: 'Other',
  agriculture: 'Other',
  official_document_management: 'Other',
  tve_design: 'Other',
  ttqav2: 'Other',
};

export function categoryForSubject(subject: string): Category {
  return SUBJECT_CATEGORY[subject] ?? 'Other';
}

/**
 * Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas and
 * newlines, and escaped double-quotes (""). Returns rows of string cells.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize CRLF to LF for stable parsing.
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (unless the file ended on a clean newline).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse a TMMLU+ CSV into header-keyed records. */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = r[i] ?? ''));
    return rec;
  });
}

/** Convert one TMMLU+ record to a MultipleChoiceCase, or null if malformed. */
export function recordToCase(
  rec: Record<string, string>,
  subject: string,
  index: number,
): MultipleChoiceCase | null {
  const question = (rec.question ?? '').trim();
  const answer = (rec.answer ?? '').trim().toUpperCase();
  const choices: Record<string, string> = {};
  for (const k of ['A', 'B', 'C', 'D']) {
    const v = (rec[k] ?? '').trim();
    if (v) choices[k] = v;
  }
  if (!question || !choices[answer] || Object.keys(choices).length < 2) return null;
  return {
    id: `tmmluplus:${subject}:${index}`,
    kind: 'multiple-choice',
    question,
    choices,
    answer,
    category: categoryForSubject(subject),
    subject,
  };
}

/** Deterministic Fisher–Yates shuffle (seeded). Does not mutate the input. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Stratified selection: aim for an even split across the categories present,
 * deterministically sampling within each. If a category has fewer items than
 * its quota, the shortfall is redistributed to the remaining items so the total
 * target is met when possible. Output order is deterministic for a given seed.
 */
export function stratifiedSelect<T>(
  items: readonly T[],
  categoryOf: (item: T) => Category,
  total: number,
  seed: string,
): T[] {
  const byCat = new Map<Category, T[]>();
  for (const it of items) {
    const cat = categoryOf(it);
    let bucket = byCat.get(cat);
    if (!bucket) {
      bucket = [];
      byCat.set(cat, bucket);
    }
    bucket.push(it);
  }
  const cats = [...byCat.keys()].sort();
  if (cats.length === 0 || total <= 0) return [];

  const baseQuota = Math.floor(total / cats.length);
  const selected: T[] = [];
  const leftovers: T[] = [];

  for (const cat of cats) {
    const shuffled = seededShuffle(byCat.get(cat)!, `${seed}:${cat}`);
    selected.push(...shuffled.slice(0, baseQuota));
    leftovers.push(...shuffled.slice(baseQuota));
  }

  // Fill remaining slots (rounding + small categories) deterministically.
  const remaining = total - selected.length;
  if (remaining > 0) {
    selected.push(...seededShuffle(leftovers, `${seed}:fill`).slice(0, remaining));
  }
  return seededShuffle(selected, `${seed}:final`).slice(0, total);
}
