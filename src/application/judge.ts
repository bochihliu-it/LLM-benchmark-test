/**
 * LLM-as-a-Judge service — the second of the three evaluation layers.
 *
 * The judge model and version are pinned and recorded with every run so scores
 * are comparable across time. A deterministic mock judge backs the offline
 * sample run; the real judge drives a fixed, low-temperature model through the
 * same LiteLLM gateway and parses a strict JSON rubric score.
 */
import type { ChatMessage, ModelClient } from '../domain/types.ts';
import { clamp } from '../domain/scoring.ts';
import { seededFloat } from '../shared/rng.ts';
import type { Logger } from '../infrastructure/logger.ts';

export interface JudgeInput {
  prompt: string;
  answer: string;
  rubric: string[];
  reference?: string;
  context?: string;
  maxPerCriterion: number;
  seedKey: string;
}

export interface JudgeVerdict {
  /** Overall score in [0, 1]. */
  score: number;
  perCriterion: number[];
  rationale: string;
}

export interface Judge {
  readonly model: string;
  readonly version: string;
  score(input: JudgeInput): Promise<JudgeVerdict>;
}

/** Token-set Jaccard overlap; the mock judge's notion of "faithfulness". */
function jaccard(a: string, b: string): number {
  const norm = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1),
    );
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class MockJudge implements Judge {
  readonly model: string;
  readonly version: string;
  constructor(model = 'mock-judge', version = 'v1') {
    this.model = model;
    this.version = version;
  }

  async score(input: JudgeInput): Promise<JudgeVerdict> {
    const basis = input.reference ?? input.context ?? input.prompt;
    const overlap = jaccard(input.answer, basis);
    // Small deterministic jitter keeps ties from being perfectly degenerate
    // without breaking the < 2% rerun-variance requirement.
    const jitter = (seededFloat(`${input.seedKey}:judge`) - 0.5) * 0.06;
    const norm = clamp(overlap * 1.25 + jitter, 0, 1);
    const perCriterion = input.rubric.map((_, i) => {
      const local = clamp(norm + (seededFloat(`${input.seedKey}:c${i}`) - 0.5) * 0.1, 0, 1);
      return Math.round(local * input.maxPerCriterion * 10) / 10;
    });
    return {
      score: norm,
      perCriterion,
      rationale: `mock judge: token overlap ${(overlap * 100).toFixed(0)}% vs reference`,
    };
  }
}

export class LlmJudge implements Judge {
  readonly model: string;
  readonly version: string;
  constructor(
    private readonly client: ModelClient,
    version: string,
    private readonly logger: Logger,
  ) {
    this.model = client.id;
    this.version = version;
  }

  async score(input: JudgeInput): Promise<JudgeVerdict> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a strict, impartial evaluator. Score the assistant answer ' +
          'against each rubric criterion. Be calibrated and terse. Respond with ' +
          'ONLY a JSON object and nothing else.',
      },
      { role: 'user', content: this.buildPrompt(input) },
    ];
    const res = await this.client.chat({ messages, temperature: 0 });
    const parsed = this.parse(res.content, input);
    if (!parsed) {
      this.logger.warn(`judge returned unparseable output for ${input.seedKey}; scoring 0`);
      return { score: 0, perCriterion: input.rubric.map(() => 0), rationale: 'unparseable judge output' };
    }
    return parsed;
  }

  private buildPrompt(input: JudgeInput): string {
    const lines: string[] = [];
    lines.push(`QUESTION:\n${input.prompt}`);
    if (input.context) lines.push(`\nCONTEXT (the answer must stay faithful to this):\n${input.context}`);
    if (input.reference) lines.push(`\nREFERENCE ANSWER:\n${input.reference}`);
    lines.push(`\nASSISTANT ANSWER:\n${input.answer}`);
    lines.push(`\nRUBRIC CRITERIA (score each 0 to ${input.maxPerCriterion}):`);
    input.rubric.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    lines.push(
      `\nRespond with JSON exactly like: {"scores": [${input.rubric
        .map(() => 'n')
        .join(', ')}], "rationale": "..."}`,
    );
    return lines.join('\n');
  }

  private parse(raw: string, input: JudgeInput): JudgeVerdict | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]) as { scores?: unknown; rationale?: unknown };
      const scores = obj.scores;
      if (!Array.isArray(scores)) return null;
      const perCriterion = input.rubric.map((_, i) => {
        const v = Number(scores[i]);
        return Number.isFinite(v) ? clamp(v, 0, input.maxPerCriterion) : 0;
      });
      const max = input.rubric.length * input.maxPerCriterion;
      const total = perCriterion.reduce((a, b) => a + b, 0);
      return {
        score: max > 0 ? total / max : 0,
        perCriterion,
        rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 280) : '',
      };
    } catch {
      return null;
    }
  }
}
