import type {
  CaseVerdict,
  EvalCase,
  EvalRun,
  EvalType,
  ExecutionStatus,
  ToolCall,
  Verdict,
} from "./eval-types";

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
  by_tier?: Record<string, unknown> | null;
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
  git_ref?: string | null;
  github_run_id?: string | number | null;
  github_run_attempt?: number | null;
  github_repository?: string | null;
  github_event?: string | null;
  manifest_url?: string | null;
  github_run_url?: string | null;
  github_job_url?: string | null;
  summary: ApiSummary;
}

interface UnitApiRun extends BaseApiRun {
  eval_type: "unit";
  skill: string;
  environment: string;
  unit_config: {
    skill_ids?: string[];
    mode?: string | null;
    metrics?: string[];
    bsa_environment?: string | null;
    bsa_version?: string | null;
    skill_version?: string | null;
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
  verdict: string;
  scores?: Record<string, number> | null;
  score_explanations?: Record<string, string> | null;
  tool_calls?: Array<{
    name: string;
    parameters: Record<string, unknown>;
    tool_call_id?: string;
  }> | null;
  validation_result?: unknown;
  prompt?: string | null;
  expected_response?: string | null;
  expected_trajectory?: unknown;
  predicted_trajectory?: unknown;
  turns?: Array<{
    turn_number: number;
    tool_calls?: Array<{
      name: string;
      parameters: Record<string, unknown>;
      tool_call_id?: string;
    }> | null;
    response?: string | null;
    validation_result?: unknown;
    genai_scores?: Record<string, number> | null;
  }> | null;
  response?: string | null;
  error?: string | null;
  skill_version?: string | null;
  bsa_version?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
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

interface ApiTrendPoint {
  run_id: string;
  started_at: string;
  verdict: string;
  score?: number | null;
  threshold?: number | null;
  pass_rate_pct: number;
  total_cases: number;
  response_time_ms?: number | null;
  skill_version?: string | null;
  bsa_version?: string | null;
}

export interface TrendQuery {
  kind: "skill" | "case" | "metric";
  evalType: EvalType;
  skill: string;
  caseId?: string;
  metric?: string;
  stage: string;
  target: string;
  environment: string;
}

export interface ApiTrendPage {
  items: Array<{
    runId: string;
    startedAt: string;
    verdict: Verdict;
    score: number;
    threshold: number;
    passRatePct: number;
    totalCases: number;
    responseTimeMs: number;
    skillVersion?: string;
    bsaVersion?: string;
    datasetVersion?: string;
  }>;
  nextCursor: string | null;
}

export interface RunBatch {
  items: EvalRun[];
  nextCursors: Record<EvalType, string | null>;
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
    byTier: value.by_tier ?? null,
  };
}

function mapToolCalls(
  calls?: Array<{
    name: string;
    parameters: Record<string, unknown>;
    tool_call_id?: string;
  }> | null,
): ToolCall[] {
  return (calls ?? []).map((call) => ({
    name: call.name,
    parameters: call.parameters ?? {},
    toolCallId: call.tool_call_id,
  }));
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
    verdict:
      run.execution_status === "error" || run.execution_status === "blocked"
        ? "blocked"
        : normalizeVerdict(run.verdict),
    startedAt: run.started_at ?? run.created_at ?? "1970-01-01T00:00:00.000Z",
    createdAt: run.created_at ?? undefined,
    completedAt: run.finished_at ?? undefined,
    durationMs: run.duration_ms ?? undefined,
    trigger: run.trigger ?? "unknown",
    actor: run.actor ?? "unknown",
    gitSha: run.git_sha ?? undefined,
    gitRef: run.git_ref ?? undefined,
    githubRunId:
      run.github_run_id != null ? String(run.github_run_id) : undefined,
    githubRunAttempt: run.github_run_attempt ?? undefined,
    githubRepository: run.github_repository ?? undefined,
    githubEvent: run.github_event ?? undefined,
    manifestUrl: run.manifest_url ?? undefined,
    githubRunUrl: run.github_run_url ?? undefined,
    githubJobUrl: run.github_job_url ?? undefined,
    policyVersion: "unit",
    datasetVersion: `${skill}@${run.unit_config.skill_version ?? "unknown"}`,
    unitConfig: {
      kind: "skill-eval",
      skillId: skill,
      skillVersion: run.unit_config.skill_version ?? "unknown",
      bsaEnvironment: run.unit_config.bsa_environment ?? run.environment,
      bsaVersion: run.unit_config.bsa_version ?? "unknown",
      mode: (run.unit_config.mode ?? "all") as
        "all" | "single-turn" | "multi-turn",
      metrics: run.unit_config.metrics ?? [],
    },
    summary: summary(run.summary),
    suites: [
      {
        name: skill,
        ...summary(run.summary),
        meanScore: numberOrZero(run.summary.mean_score),
      },
    ],
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
    verdict:
      run.execution_status === "error"
        ? "blocked"
        : normalizeVerdict(run.verdict),
    startedAt: run.started_at ?? run.created_at ?? "1970-01-01T00:00:00.000Z",
    createdAt: run.created_at ?? undefined,
    completedAt: run.finished_at ?? undefined,
    durationMs: run.duration_ms ?? undefined,
    trigger: run.trigger ?? "unknown",
    actor: run.actor ?? "unknown",
    gitSha: run.git_sha ?? undefined,
    gitRef: run.git_ref ?? undefined,
    githubRunId:
      run.github_run_id != null ? String(run.github_run_id) : undefined,
    githubRunAttempt: run.github_run_attempt ?? undefined,
    githubRepository: run.github_repository ?? undefined,
    githubEvent: run.github_event ?? undefined,
    manifestUrl: run.manifest_url ?? undefined,
    githubRunUrl: run.github_run_url ?? undefined,
    githubJobUrl: run.github_job_url ?? undefined,
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
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort("request-timeout"),
      15_000,
    );

    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}${path}`,
        {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Eval API ${response.status}: ${detail || response.statusText}`,
        );
      }
      return response.json() as Promise<T>;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error("Eval API request timed out after 15 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async listRunBatch(
    cursors?: Partial<Record<EvalType, string | null>>,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<RunBatch> {
    const loadUnit = cursors?.unit !== null;
    const loadE2E = cursors?.e2e !== null;
    const query = (cursor: string | undefined) =>
      `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const [unit, e2e] = await Promise.all([
      loadUnit
        ? this.request<Page<UnitApiRun>>(
            `/unit/runs${query(cursors?.unit ?? undefined)}`,
            signal,
          )
        : Promise.resolve({ items: [], next_cursor: null }),
      loadE2E
        ? this.request<Page<E2EApiRun>>(
            `/e2e/runs${query(cursors?.e2e ?? undefined)}`,
            signal,
          )
        : Promise.resolve({ items: [], next_cursor: null }),
    ]);
    return {
      items: [...unit.items.map(mapUnitRun), ...e2e.items.map(mapE2ERun)].sort(
        (a, b) => b.startedAt.localeCompare(a.startedAt),
      ),
      nextCursors: {
        unit: unit.next_cursor ?? null,
        e2e: e2e.next_cursor ?? null,
      },
    };
  }

  async listRuns(signal?: AbortSignal): Promise<EvalRun[]> {
    return (await this.listRunBatch(undefined, 50, signal)).items;
  }

  async getRun(
    evalType: EvalType,
    runId: string,
    signal?: AbortSignal,
  ): Promise<EvalRun> {
    const path = `/${evalType}/runs/${encodeURIComponent(runId)}`;
    return evalType === "e2e"
      ? mapE2ERun(await this.request<E2EApiRun>(path, signal))
      : mapUnitRun(await this.request<UnitApiRun>(path, signal));
  }

  async listTrend(
    query: TrendQuery,
    cursor?: string | null,
    limit = 30,
    signal?: AbortSignal,
  ): Promise<ApiTrendPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    let path: string;
    if (query.evalType === "e2e") {
      params.set("stage", query.stage);
      params.set("target", query.target);
      if (query.kind === "case") {
        params.set("suite", query.skill);
        path = `/e2e/trends/cases/${encodeURIComponent(query.caseId ?? "")}`;
      } else {
        path = `/e2e/trends/suites/${encodeURIComponent(query.skill)}`;
      }
    } else {
      params.set("environment", query.environment);
      if (query.kind === "case") {
        params.set("skill", query.skill);
        path = `/unit/trends/cases/${encodeURIComponent(query.caseId ?? "")}`;
      } else {
        if (query.kind === "metric" && query.metric) {
          params.set("metric", query.metric);
        }
        path = `/unit/trends/skills/${encodeURIComponent(query.skill)}`;
      }
    }
    const page = await this.request<Page<ApiTrendPoint>>(
      `${path}?${params}`,
      signal,
    );
    return {
      items: page.items.map((point) => ({
        runId: point.run_id,
        startedAt: point.started_at,
        verdict: normalizeVerdict(point.verdict),
        score: numberOrZero(point.score),
        threshold: numberOrZero(point.threshold),
        passRatePct: point.pass_rate_pct,
        totalCases: point.total_cases,
        responseTimeMs: numberOrZero(point.response_time_ms),
        skillVersion: point.skill_version ?? undefined,
        bsaVersion: point.bsa_version ?? undefined,
        datasetVersion:
          query.evalType === "e2e"
            ? `e2e/${query.stage}/${query.target}`
            : undefined,
      })),
      nextCursor: page.next_cursor ?? null,
    };
  }

  async listCases(run: EvalRun, signal?: AbortSignal): Promise<EvalCase[]> {
    if (run.evalType === "e2e") {
      const page = await this.request<Page<E2EApiCase>>(
        `/e2e/runs/${encodeURIComponent(run.runId)}/cases?limit=200`,
        signal,
      );
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
    const page = await this.request<Page<UnitApiCase>>(
      `/unit/runs/${encodeURIComponent(run.runId)}/cases?limit=200`,
      signal,
    );
    return page.items.map((item) => {
      const mappedScores = item.scores ?? {};
      const scores = Object.values(mappedScores);
      return {
        caseId: item.case_id,
        testName: item.test_name,
        runId: item.run_id,
        suite: item.skill,
        skill: item.skill,
        role: item.test_type,
        verdict: normalizeCaseVerdict(item.verdict),
        score: scores.length
          ? scores.reduce((sum, value) => sum + value, 0) / scores.length
          : 0,
        threshold: 4,
        responseTimeMs: 0,
        input: item.prompt ?? item.test_name,
        responseText: item.response ?? "",
        explanation:
          "Each unit metric is gated independently; inspect the metric scores and tool calls below.",
        scores: mappedScores,
        toolCalls: mapToolCalls(item.tool_calls),
        skillVersion: item.skill_version ?? undefined,
        bsaVersion: item.bsa_version ?? undefined,
        error: item.error ?? undefined,
        expectedResponse: item.expected_response ?? undefined,
        expectedTrajectory: item.expected_trajectory ?? undefined,
        predictedTrajectory: item.predicted_trajectory ?? undefined,
        scoreExplanations: item.score_explanations ?? undefined,
        validationResult: item.validation_result ?? undefined,
        turns:
          item.turns?.map((turn) => ({
            turnNumber: turn.turn_number,
            toolCalls: mapToolCalls(turn.tool_calls),
            response: turn.response ?? "",
            validationResult: turn.validation_result ?? undefined,
            scores: turn.genai_scores ?? {},
          })) ?? undefined,
        startedAt: item.started_at ?? undefined,
        finishedAt: item.finished_at ?? undefined,
        durationMs: item.duration_ms ?? undefined,
      };
    });
  }
}

export function configuredEvalApi(): EvalApi | null {
  const baseUrl = process.env.NEXT_PUBLIC_EVAL_API_URL?.trim();
  return baseUrl ? new EvalApi(baseUrl) : null;
}
