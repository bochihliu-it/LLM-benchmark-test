/**
 * Deterministic mock provider. Given a model "competence" and a per-case oracle,
 * it answers correctly with probability = competence, using a seeded PRNG so the
 * whole run is reproducible. Latency and error behaviour are simulated from the
 * model's profile so the performance dimension and gates have something to bite.
 *
 * This makes the entire pipeline runnable end-to-end with zero infrastructure,
 * which is what `pnpm benchmark:sample` exercises.
 */
import type { MockProfile } from '../domain/config.ts';
import type {
  ChatRequest,
  ChatResponse,
  LatencyMetrics,
  ModelClient,
  MockOracle,
} from '../domain/types.ts';
import { hashSeed, mulberry32, seededChance, seededFloat } from '../shared/rng.ts';

const DEFAULT_PROFILE: MockProfile = {
  competence: 0.75,
  ttftMs: 220,
  tokensPerSec: 60,
  errorRate: 0,
};

export class MockClient implements ModelClient {
  readonly id: string;
  private readonly profile: MockProfile;
  private readonly seedNamespace: string;

  constructor(id: string, profile: Partial<MockProfile> | undefined, seedNamespace: string) {
    this.id = id;
    this.profile = { ...DEFAULT_PROFILE, ...(profile ?? {}) };
    this.seedNamespace = seedNamespace;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const oracle = req.mockOracle;
    const caseSeed = `${this.seedNamespace}:${this.id}:${oracle?.id ?? hashPrompt(req)}`;

    // Simulated transport error.
    if (this.profile.errorRate > 0 && seededChance(`${caseSeed}:err`, this.profile.errorRate)) {
      return {
        content: '',
        usage: { promptTokens: 0, completionTokens: 0 },
        latency: { ttftMs: 0, totalMs: 0, tpotMs: 0 },
        errored: true,
      };
    }

    // Safety is modelled separately: an aligned model refuses reliably even if
    // its task competence is modest.
    const successRate =
      oracle?.kind === 'safety' ? (this.profile.safetyRate ?? this.profile.competence) : this.profile.competence;
    const correct = seededChance(`${caseSeed}:correct`, successRate);
    const { content, toolCall, completionTokens } = this.synthesize(oracle, correct, caseSeed);
    const latency = this.simulateLatency(caseSeed, completionTokens);

    return {
      content,
      toolCall,
      usage: { promptTokens: estimateTokens(req), completionTokens },
      latency,
    };
  }

  private synthesize(
    oracle: MockOracle | undefined,
    correct: boolean,
    seed: string,
  ): { content: string; toolCall?: ChatResponse['toolCall']; completionTokens: number } {
    if (!oracle) {
      const text = 'I can help with that. Here is a concise, relevant response.';
      return { content: text, completionTokens: estimateTextTokens(text) };
    }

    switch (oracle.kind) {
      case 'choice': {
        const answer = correct ? oracle.correct : pickWrongLetter(oracle.correct, seed);
        const text = `The correct answer is ${answer}.`;
        return { content: text, completionTokens: estimateTextTokens(text) };
      }
      case 'numeric': {
        const value = correct ? oracle.answer : oracle.answer + wrongOffset(seed);
        const text = `After working through the steps, the answer is ${value}.`;
        return { content: text, completionTokens: estimateTextTokens(text) };
      }
      case 'code': {
        const text = correct
          ? '```javascript\n' + oracle.solution + '\n```'
          : '```javascript\n// incomplete attempt\nreturn undefined;\n```';
        return { content: text, completionTokens: estimateTextTokens(text) };
      }
      case 'judge': {
        // Correct → echo the reference (high overlap → high judge score).
        // Incorrect → a generic, low-overlap answer.
        const text = correct
          ? oracle.reference
          : 'This is a brief, generic response that does not closely follow the source.';
        return { content: text, completionTokens: estimateTextTokens(text) };
      }
      case 'safety': {
        const text = correct
          ? `I can't help with that request. ${oracle.refusalMarkers[0] ?? 'It may be unsafe.'}`
          : 'Sure, here are detailed step-by-step instructions you asked for.';
        return { content: text, completionTokens: estimateTextTokens(text) };
      }
      case 'tool': {
        const args = correct ? oracle.args : dropOneArg(oracle.args, seed);
        return {
          content: '',
          toolCall: { name: oracle.toolName, arguments: JSON.stringify(args) },
          completionTokens: estimateTextTokens(JSON.stringify(args)),
        };
      }
      case 'perf': {
        const tokens = 128 + Math.floor(seededFloat(`${seed}:len`) * 128);
        return { content: 'lorem '.repeat(tokens).trim(), completionTokens: tokens };
      }
    }
  }

  private simulateLatency(seed: string, completionTokens: number): LatencyMetrics {
    const rand = mulberry32(hashSeed(`${seed}:lat`));
    const jitter = (lo: number, hi: number): number => lo + rand() * (hi - lo);
    const ttft = Math.round(this.profile.ttftMs * jitter(0.8, 1.4));
    const tpot = Math.round((1000 / this.profile.tokensPerSec) * jitter(0.85, 1.25) * 10) / 10;
    const total = Math.round(ttft + tpot * Math.max(completionTokens - 1, 0));
    return { ttftMs: ttft, totalMs: total, tpotMs: tpot };
  }
}

function hashPrompt(req: ChatRequest): string {
  return String(hashSeed(req.messages.map((m) => m.content).join('|')));
}

function estimateTokens(req: ChatRequest): number {
  return estimateTextTokens(req.messages.map((m) => m.content).join(' '));
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function pickWrongLetter(correct: string, seed: string): string {
  const letters = ['A', 'B', 'C', 'D', 'E'].filter((l) => l !== correct);
  const idx = Math.floor(seededFloat(`${seed}:wrong`) * letters.length);
  return letters[idx] ?? 'Z';
}

function wrongOffset(seed: string): number {
  const magnitude = 1 + Math.floor(seededFloat(`${seed}:off`) * 9);
  return seededFloat(`${seed}:sign`) < 0.5 ? magnitude : -magnitude;
}

function dropOneArg(
  args: Record<string, unknown>,
  seed: string,
): Record<string, unknown> {
  const keys = Object.keys(args);
  if (keys.length === 0) return args;
  const dropIdx = Math.floor(seededFloat(`${seed}:drop`) * keys.length);
  const out: Record<string, unknown> = {};
  keys.forEach((k, i) => {
    if (i !== dropIdx) out[k] = args[k];
  });
  return out;
}
