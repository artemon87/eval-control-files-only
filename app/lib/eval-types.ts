export type EvalType = "e2e" | "unit";
export type Trigger = "ui" | "cli" | "ci" | "schedule" | string;
export type ExecutionStatus = "queued" | "running" | "completed" | "error" | "cancelled";
export type Verdict = "passed" | "failed" | "blocked" | "pending";

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  passRatePct: number;
  meanScore: number;
  p95ResponseTimeMs: number;
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
  completedAt?: string;
  durationMs?: number;
  trigger: Trigger;
  actor: string;
  gitSha?: string;
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

export interface EvalCase {
  caseId: string;
  runId: string;
  suite: string;
  skill: string;
  role: string;
  tier: number;
  verdict: "passed" | "failed" | "error";
  score: number;
  threshold: number;
  responseTimeMs: number;
  input: string;
  responseText: string;
  explanation: string;
  scores?: Record<string, number>;
  toolCalls?: ToolCall[];
  skillVersion?: string;
  bsaVersion?: string;
  error?: string;
  bugRef?: string;
}
