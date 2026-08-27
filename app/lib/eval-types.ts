export type EvalType = "e2e" | "unit";
export type Trigger = "ui" | "cli" | "ci" | "schedule" | string;
export type ExecutionStatus =
  "queued" | "running" | "completed" | "blocked" | "error" | "cancelled";
export type Verdict = "passed" | "failed" | "blocked" | "pending" | "xpassed";
export type CaseVerdict = "passed" | "failed" | "blocked" | "error" | "xpassed";

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  passRatePct: number;
  meanScore: number;
  p95ResponseTimeMs: number;
  byTier?: Record<string, unknown> | null;
}

export interface SuiteSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  meanScore: number;
}

export interface E2ERunConfig {
  kind: "live-target";
  targetId: string;
  selectedSuites: string[];
  maxTier: "all" | 1 | 2 | 3;
  /** Target-level fraction (0-1) or percentage (0-100) required to pass. */
  passRateThreshold?: number;
}

export interface UnitRunConfig {
  kind: "skill-eval";
  skillId: string;
  skillVersion: string;
  bsaEnvironment: string;
  bsaVersion: string;
  mode: "all" | "single-turn" | "multi-turn";
  metrics: string[];
}

export interface EvalRun {
  runId: string;
  batchId?: string;
  evalType: EvalType;
  stage: string;
  target: string;
  executionStatus: ExecutionStatus;
  verdict: Verdict;
  startedAt: string;
  createdAt?: string;
  completedAt?: string;
  durationMs?: number;
  trigger: Trigger;
  actor: string;
  gitSha?: string;
  gitRef?: string;
  githubRunId?: string;
  githubRunAttempt?: number;
  githubRepository?: string;
  githubEvent?: string;
  manifestUrl?: string;
  githubRunUrl?: string;
  githubJobUrl?: string;
  policyVersion: string;
  datasetVersion: string;
  e2eConfig?: E2ERunConfig;
  unitConfig?: UnitRunConfig;
  summary: RunSummary;
  suites: SuiteSummary[];
}

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
  toolCallId?: string;
}

export interface EvalTurn {
  turnNumber: number;
  toolCalls: ToolCall[];
  response: string;
  validationResult?: unknown;
  scores: Record<string, number>;
}

export interface EvalCase {
  caseId: string;
  testName?: string;
  runId: string;
  suite: string;
  skill: string;
  role: string;
  tier?: number;
  verdict: CaseVerdict;
  score: number;
  threshold: number;
  responseTimeMs: number;
  /** Exact authored prompt, when the result producer persisted a snapshot. */
  input?: string;
  responseText: string;
  explanation: string;
  scores?: Record<string, number>;
  toolCalls?: ToolCall[];
  skillVersion?: string;
  bsaVersion?: string;
  error?: string;
  bugRef?: string;
  expectedResponse?: string;
  expectedTrajectory?: unknown;
  predictedTrajectory?: unknown;
  scoreExplanations?: Record<string, string>;
  validationResult?: unknown;
  turns?: EvalTurn[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}
