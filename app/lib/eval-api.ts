import type { CaseVerdict, EvalCase, EvalRun, ExecutionStatus, Verdict } from "./eval-types";

export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
}

interface ApiSummary {
  total: number;
  passed: number;
  failed: number;
  pass_rate_pct: number;
  mean_score?: number | null;
}

interface BaseApiRun {
  run_id: string;
  batch_id?: string | null;
  execution_status: ExecutionStatus;
  verdict: string;
  started_at?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  trigger?: string | null;
  actor?: string | null;
  git_sha?: string | null;
  summary: ApiSummary;
}

interface UnitApiRun extends BaseApiRun {
  eval_type: "unit";
  skill: string;
  environment: string;
  unit_config: {
    skill_ids: [string];
    mode?: string | null;
    metrics?: string[];
    bsa_environment: string;
    bsa_version: string;
    skill_version: string;
  };
}

interface E2EApiRun extends BaseApiRun {
  eval_type: "e2e";
  stage: string;
  target: string;
  e2e_config: {
    selected_suites: string[];
    max_tier?: number | null;
    pass_rate_threshold?: number | null;
    live_conversation: boolean;
  };
}

interface UnitApiCase {
  case_id: string;
  run_id: string;
  skill: string;
  test_name: string;
  test_type: string;
  tier?: number | null;
  verdict: string;
  scores: Record<string, number>;
  tool_calls: Array<{ name: string; parameters: Record<string, unknown>; tool_call_id?: string }>;
  response?: string | null;
  error?: string | null;
  skill_version: string;
  bsa_version: string;
}

interface E2EApiCase {
  case_id: string;
  run_id: string;
  suite: string;
  role?: string | null;
  tier?: number | null;
  verdict: string;
  score?: number | null;
  threshold?: number | null;
  response_time_ms?: number | null;
  response_text?: string | null;
  explanation?: string | null;
  error?: string | null;
  bug_ref?: string | null;
}

function numberOrZero(value?: number | null) {
  return typeof value === "number" ? value : 0;
}

function normalizeVerdict(value: string | null | undefined): Verdict {
  switch (value?.trim().toLowerCase()) {
    case "pass":
    case "passed":
      return "passed";
    case "fail":
    case "failed":
      return "failed";
    case "block":
    case "blocked":
    case "error":
      return "blocked";
    case "xpass":
    case "xpassed":
    case "unexpected_pass":
    case "unexpected-pass":
      return "xpassed";
    default:
      return "pending";
  }
}

function normalizeCaseVerdict(value: string | null | undefined): CaseVerdict {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "error") return "error";
  return normalizeVerdict(normalized) as CaseVerdict;
}

function summary(value: ApiSummary) {
  return {
    total: value.total,
    passed: value.passed,
    failed: value.failed,
    passRatePct: value.pass_rate_pct,
    meanScore: numberOrZero(value.mean_score),
    p95ResponseTimeMs: 0,
  };
}

function mapUnitRun(run: UnitApiRun): EvalRun {
  const skill = run.skill;
  return {
    runId: run.run_id,
    batchId: run.batch_id ?? undefined,
    evalType: "unit",
    stage: run.environment,
    target: skill,
    executionStatus: run.execution_status,
    verdict: run.execution_status === "error" ? "blocked" : normalizeVerdict(run.verdict),
    startedAt: run.started_at ?? run.created_at ?? "1970-01-01T00:00:00.000Z",
    completedAt: run.finished_at ?? undefined,
    durationMs: run.duration_ms ?? undefined,
    trigger: run.trigger ?? "unknown",
    actor: run.actor ?? "unknown",
    gitSha: run.git_sha ?? undefined,
    policyVersion: "unit",
    datasetVersion: `${skill}@${run.unit_config.skill_version}`,
    unitConfig: {
      kind: "skill-eval",
      skillId: skill,
      skillVersion: run.unit_config.skill_version,
      bsaEnvironment: run.unit_config.bsa_environment,
      bsaVersion: run.unit_config.bsa_version,
      mode: (run.unit_config.mode ?? "all") as "all" | "single-turn" | "multi-turn",
      metrics: run.unit_config.metrics ?? [],
    },
    summary: summary(run.summary),
    suites: [{ name: skill, ...summary(run.summary), meanScore: numberOrZero(run.summary.mean_score) }],
  };
}

function mapE2ERun(run: E2EApiRun): EvalRun {
  return {
    runId: run.run_id,
    batchId: run.batch_id ?? undefined,
    evalType: "e2e",
    stage: run.stage,
    target: run.target,
    executionStatus: run.execution_status,
    verdict: run.execution_status === "error" ? "blocked" : normalizeVerdict(run.verdict),
    startedAt: run.started_at ?? run.created_at ?? "1970-01-01T00:00:00.000Z",
    completedAt: run.finished_at ?? undefined,
    durationMs: run.duration_ms ?? undefined,
    trigger: run.trigger ?? "unknown",
    actor: run.actor ?? "unknown",
    gitSha: run.git_sha ?? undefined,
    policyVersion: "e2e",
    datasetVersion: `e2e/${run.stage}/${run.target}/target.yaml`,
    e2eConfig: {
      kind: "live-target",
      targetId: run.target,
      selectedSuites: run.e2e_config.selected_suites,
      maxTier: (run.e2e_config.max_tier ?? "all") as "all" | 1 | 2 | 3,
      passRateThreshold: run.e2e_config.pass_rate_threshold ?? undefined,
    },
    summary: summary(run.summary),
    suites: run.e2e_config.selected_suites.map((name) => ({
      name,
      total: 0,
      passed: 0,
      failed: 0,
      meanScore: 0,
    })),
  };
}

export class EvalApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Eval API ${response.status}: ${detail || response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async listRuns(signal?: AbortSignal): Promise<EvalRun[]> {
    const [unit, e2e] = await Promise.all([
      this.request<Page<UnitApiRun>>("/unit/runs?limit=200", signal),
      this.request<Page<E2EApiRun>>("/e2e/runs?limit=200", signal),
    ]);
    return [...unit.items.map(mapUnitRun), ...e2e.items.map(mapE2ERun)]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listCases(run: EvalRun, signal?: AbortSignal): Promise<EvalCase[]> {
    if (run.evalType === "e2e") {
      const page = await this.request<Page<E2EApiCase>>(`/e2e/runs/${encodeURIComponent(run.runId)}/cases?limit=200`, signal);
      return page.items.map((item) => ({
        caseId: item.case_id,
        runId: item.run_id,
        suite: item.suite,
        skill: item.suite,
        role: item.role ?? "unknown",
        tier: item.tier ?? 0,
        verdict: normalizeCaseVerdict(item.verdict),
        score: numberOrZero(item.score),
        threshold: numberOrZero(item.threshold),
        responseTimeMs: numberOrZero(item.response_time_ms),
        input: undefined,
        responseText: item.response_text ?? "",
        explanation: item.explanation ?? "",
        error: item.error ?? undefined,
        bugRef: item.bug_ref ?? undefined,
      }));
    }
    const page = await this.request<Page<UnitApiCase>>(`/unit/runs/${encodeURIComponent(run.runId)}/cases?limit=200`, signal);
    return page.items.map((item) => {
      const scores = Object.values(item.scores);
      return {
        caseId: item.case_id,
        runId: item.run_id,
        suite: item.skill,
        skill: item.skill,
        role: item.test_type,
        tier: item.tier ?? 0,
        verdict: normalizeCaseVerdict(item.verdict),
        score: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
        threshold: 4,
        responseTimeMs: 0,
        input: item.test_name,
        responseText: item.response ?? "",
        explanation: "Each unit metric is gated independently; inspect the metric scores and tool calls below.",
        scores: item.scores,
        toolCalls: item.tool_calls.map((call) => ({ name: call.name, parameters: call.parameters, toolCallId: call.tool_call_id })),
        skillVersion: item.skill_version,
        bsaVersion: item.bsa_version,
        error: item.error ?? undefined,
      };
    });
  }
}

export function configuredEvalApi(): EvalApi | null {
  const baseUrl = process.env.NEXT_PUBLIC_EVAL_API_URL?.trim();
  return baseUrl ? new EvalApi(baseUrl) : null;
}
