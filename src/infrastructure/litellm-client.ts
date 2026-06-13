/**
 * OpenAI-compatible client that talks to the LiteLLM gateway. Evaluation goes
 * through the exact same API the downstream apps use, so the measured behaviour
 * (timeouts, retries, streaming) matches production.
 *
 * Streaming is used by default purely to measure time-to-first-token honestly.
 */
import type {
  ChatRequest,
  ChatResponse,
  LatencyMetrics,
  ModelClient,
  ToolCall,
} from '../domain/types.ts';
import type { Logger } from './logger.ts';

export interface LiteLlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  stream: boolean;
  logger: Logger;
}

interface OpenAiToolCall {
  function?: { name?: string; arguments?: string };
}

interface OpenAiDelta {
  content?: string;
  tool_calls?: OpenAiToolCall[];
}

export class LiteLlmClient implements ModelClient {
  readonly id: string;
  private readonly opts: LiteLlmOptions;

  constructor(opts: LiteLlmOptions) {
    this.opts = opts;
    this.id = opts.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        return this.opts.stream && !req.tools
          ? await this.chatStreaming(req)
          : await this.chatBuffered(req);
      } catch (err) {
        lastError = err;
        const backoff = 250 * 2 ** attempt;
        this.opts.logger.warn(
          `chat attempt ${attempt + 1} failed for ${this.id}; retrying in ${backoff}ms`,
          err instanceof Error ? err.message : String(err),
        );
        await delay(backoff);
      }
    }
    this.opts.logger.error(`chat exhausted retries for ${this.id}`, String(lastError));
    return emptyErrored();
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
      stream,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.seed !== undefined) body.seed = req.seed;
    if (req.tools) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = req.toolChoice
        ? { type: 'function', function: { name: req.toolChoice } }
        : 'auto';
    }
    return body;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.opts.apiKey}`,
    };
  }

  private async chatBuffered(req: ChatRequest): Promise<ChatResponse> {
    const start = performance.now();
    const res = await this.fetchWithTimeout('/v1/chat/completions', this.buildBody(req, false));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: OpenAiToolCall[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const total = performance.now() - start;
    const choice = json.choices?.[0]?.message;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const latency: LatencyMetrics = {
      ttftMs: Math.round(total),
      totalMs: Math.round(total),
      tpotMs: completionTokens > 0 ? Math.round((total / completionTokens) * 10) / 10 : 0,
    };
    return {
      content: choice?.content ?? '',
      toolCall: firstToolCall(choice?.tool_calls),
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens,
      },
      latency,
    };
  }

  private async chatStreaming(req: ChatRequest): Promise<ChatResponse> {
    const start = performance.now();
    const res = await this.fetchWithTimeout('/v1/chat/completions', this.buildBody(req, true));
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let ttft = 0;
    let chunks = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as { choices?: { delta?: OpenAiDelta }[] };
          const piece = parsed.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            if (ttft === 0) ttft = performance.now() - start;
            content += piece;
            chunks++;
          }
        } catch {
          // ignore keep-alive / partial frames
        }
      }
    }

    const total = performance.now() - start;
    const latency: LatencyMetrics = {
      ttftMs: Math.round(ttft || total),
      totalMs: Math.round(total),
      tpotMs: chunks > 1 ? Math.round(((total - ttft) / (chunks - 1)) * 10) / 10 : 0,
    };
    return {
      content,
      usage: { promptTokens: 0, completionTokens: chunks },
      latency,
    };
  }

  private async fetchWithTimeout(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      return await fetch(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function firstToolCall(calls?: OpenAiToolCall[]): ToolCall | undefined {
  const fn = calls?.[0]?.function;
  if (!fn?.name) return undefined;
  return { name: fn.name, arguments: fn.arguments ?? '{}' };
}

function emptyErrored(): ChatResponse {
  return {
    content: '',
    usage: { promptTokens: 0, completionTokens: 0 },
    latency: { ttftMs: 0, totalMs: 0, tpotMs: 0 },
    errored: true,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '<no body>';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
