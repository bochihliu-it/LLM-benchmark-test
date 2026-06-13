/**
 * Core domain types for the AI Benchmark system.
 *
 * The unit of evaluation is a "run": one model-under-test exercised across a set
 * of enabled dimensions in a single pass, producing one comparable, versioned
 * result document. The whole point of the design is that heterogeneous
 * dimensions (objective MCQ, LLM-as-Judge, performance load) are produced by the
 * same orchestrator and aggregated into one decision.
 */

export type DimensionId =
  | 'general'
  | 'reasoning'
  | 'code'
  | 'zh-tw'
  | 'rag'
  | 'tool-use'
  | 'safety'
  | 'performance';

/** How a dimension's per-case score is produced. */
export type EvaluationMethod = 'objective' | 'judge' | 'performance';

/** Decision-matrix grouping used for weighted aggregation. */
export type DimensionGroup =
  | 'capability'
  | 'application'
  | 'reliability-safety'
  | 'performance-cost';

// --- Chat transport (OpenAI-compatible, as exposed by LiteLLM) ----------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Mock-only side channel. The real LiteLLM client never reads this, so ground
 * truth is never serialized onto the wire; the deterministic mock provider uses
 * it to synthesize a correct-or-incorrect answer at the model's competence.
 */
export type MockOracle =
  | { id: string; kind: 'choice'; correct: string }
  | { id: string; kind: 'numeric'; answer: number }
  | { id: string; kind: 'code'; solution: string }
  | { id: string; kind: 'judge'; reference: string }
  | { id: string; kind: 'safety'; refusalMarkers: string[] }
  | { id: string; kind: 'tool'; toolName: string; args: Record<string, unknown> }
  | { id: string; kind: 'perf' };

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When provided, the model is asked to emit a tool call (function call). */
  tools?: ToolSchema[];
  /** Force a specific tool by name (used by the tool-use dimension). */
  toolChoice?: string;
  seed?: number;
  /** Ignored by real clients; consumed only by the mock provider. */
  mockOracle?: MockOracle;
}

export interface LatencyMetrics {
  /** Time to first token (ms). For non-streamed calls equals totalMs. */
  ttftMs: number;
  /** End-to-end wall time (ms). */
  totalMs: number;
  /** Time-per-output-token (ms/token), averaged over generation. */
  tpotMs: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ToolCall {
  name: string;
  /** Raw JSON string of arguments, as returned by the model. */
  arguments: string;
}

export interface ChatResponse {
  content: string;
  toolCall?: ToolCall;
  usage: TokenUsage;
  latency: LatencyMetrics;
  /** True if the gateway/model errored and a fallback empty answer was used. */
  errored?: boolean;
}

export interface ModelClient {
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

// --- Datasets -----------------------------------------------------------------

/** A multiple-choice case with exactly one correct option (objective). */
export interface MultipleChoiceCase {
  id: string;
  kind: 'multiple-choice';
  question: string;
  choices: Record<string, string>; // { A: "...", B: "..." }
  answer: string; // key into choices
}

/** A numeric short-answer case scored by exact match after extraction. */
export interface NumericCase {
  id: string;
  kind: 'numeric';
  question: string;
  answer: number;
  tolerance?: number;
}

/** A code-generation case validated by running assertions in a sandbox. */
export interface CodeCase {
  id: string;
  kind: 'code';
  prompt: string;
  /** Name of the JS function the model must implement. */
  entrypoint: string;
  /** Reference solution used by the mock provider. */
  canonicalSolution: string;
  /** Assertions evaluated against the model's function. */
  tests: string[];
}

/** An open-ended case graded by the judge against a rubric. */
export interface JudgeCase {
  id: string;
  kind: 'judge';
  prompt: string;
  /** Optional retrieved context (RAG faithfulness). */
  context?: string;
  /** Rubric criteria; the judge scores each 0..maxPerCriterion. */
  rubric: string[];
  maxPerCriterion?: number;
  /** For the mock judge: an expected "ideal" answer fingerprint. */
  referenceAnswer?: string;
}

/** A safety/red-team case: the model SHOULD refuse or safely deflect. */
export interface SafetyCase {
  id: string;
  kind: 'safety';
  prompt: string;
  /** Phrases whose presence indicates a safe refusal. */
  refusalMarkers: string[];
}

/** A tool-use case requiring a structured function call matching a schema. */
export interface ToolUseCase {
  id: string;
  kind: 'tool-use';
  prompt: string;
  tool: ToolSchema;
  /** Required argument names that must appear in the emitted JSON. */
  requiredArgs: string[];
  /** Optional expected values for a subset of arguments. */
  expectedArgs?: Record<string, string | number | boolean>;
}

/** A performance case: a representative prompt run under load. */
export interface PerfCase {
  id: string;
  kind: 'perf';
  prompt: string;
  /** Output tokens to request, to size the generation. */
  maxTokens: number;
}

export type TaskCase =
  | MultipleChoiceCase
  | NumericCase
  | CodeCase
  | JudgeCase
  | SafetyCase
  | ToolUseCase
  | PerfCase;

export interface Dataset<C extends TaskCase = TaskCase> {
  dimension: DimensionId;
  version: string;
  /** Content hash, filled in by the loader for reproducibility metadata. */
  checksum?: string;
  cases: C[];
}

// --- Results ------------------------------------------------------------------

export interface CaseResult {
  caseId: string;
  method: EvaluationMethod;
  /** Normalized score in [0, 1]. */
  score: number;
  passed: boolean;
  /** Whether this case was drawn for human review this run. */
  sampledForReview: boolean;
  latency: LatencyMetrics;
  errored: boolean;
  detail: string;
}

export interface DimensionResult {
  dimensionId: DimensionId;
  group: DimensionGroup;
  method: EvaluationMethod;
  /** Dimension score in [0, 100]. */
  rawScore: number;
  cases: CaseResult[];
  /** Aggregate metrics surfaced for reporting (e.g. perf percentiles). */
  metrics: Record<string, number>;
  datasetVersion: string;
  datasetChecksum: string;
}

export interface GateResult {
  id: string;
  label: string;
  comparator: '>=' | '<=' | '<' | '>';
  threshold: number;
  actual: number;
  passed: boolean;
}

export interface AggregateScore {
  /** Weighted overall score in [0, 100]. */
  overall: number;
  /** Per-group weighted contribution. */
  groups: Record<DimensionGroup, { weight: number; score: number }>;
  perDimension: Record<string, number>;
  gates: GateResult[];
  gatesPassed: boolean;
}

export interface RunEnvironment {
  harnessVersion: string;
  node: string;
  seed: string;
  judgeModel: string;
  judgeVersion: string;
  litellmBaseUrl: string;
}

export interface BenchmarkResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  model: {
    id: string;
    provider: string;
    label: string;
    params?: string;
    quantization?: string;
    vramGb?: number;
  };
  environment: RunEnvironment;
  dimensions: DimensionResult[];
  aggregate: AggregateScore;
}
