"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { configuredEvalApi, type EvalApi } from "./lib/eval-api";
import type { EvalCase, EvalRun, EvalType, ExecutionStatus, SuiteSummary, Verdict } from "./lib/eval-types";

type View = "overview" | "runs" | "history" | "compare" | "schema";

type DrilldownTrendKind = "skill" | "case";

type DrilldownTrendRequest = {
  kind: DrilldownTrendKind;
  evalType: EvalType;
  skill: string;
  caseId?: string;
  stage: string;
  target: string;
  environment: string;
  sourceRunId: string;
};

type DrilldownTrendPoint = {
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
};

type E2EHistoryPoint = {
  runId: string;
  batchId?: string;
  startedAt: string;
  stage: string;
  target: string;
  passRatePct: number;
  meanScore: number;
  totalCases: number;
  durationMs: number;
  verdict: Verdict;
};

type DataState = "connecting" | "live" | "unconfigured" | "error";

const navItems: { id: View; label: string; glyph: string }[] = [
  { id: "overview", label: "Overview", glyph: "⌂" },
  { id: "runs", label: "Evaluation runs", glyph: "▤" },
  { id: "history", label: "History", glyph: "↗" },
  { id: "compare", label: "Compare", glyph: "⇄" },
  { id: "schema", label: "Data model", glyph: "◇" },
];

const unitSkills = [
  { id: "feedback-skill", label: "Feedback", tools: ["submit_feedback"] },
  { id: "time-off-balance-skill", label: "Time-off balance", tools: ["get_time_off_balance"] },
  { id: "create-requisition-skill", label: "Create requisition", tools: ["create_requisition", "get_requisition"] },
  { id: "verify-license-skill", label: "Verify license", tools: ["verify_license"] },
];

const e2eSuites = [
  { id: "navigation", label: "Navigation", note: "Live product navigation conversations" },
  { id: "feedback", label: "Feedback", note: "Live feedback submission conversations" },
  { id: "general_inquiry", label: "General inquiry", note: "Cross-skill live assistant behavior" },
];

function StatusBadge({ verdict }: { verdict: Verdict }) {
  const label = verdict === "xpassed" ? "XPASS" : verdict;
  const title = verdict === "xpassed" ? "Unexpected pass: this known-bug/expected-failure case passed and should be reviewed" : undefined;
  return <span className={`status status--${verdict}`} title={title} aria-label={title ? `${label}: ${title}` : label}><i />{label}</span>;
}

function effectiveRunVerdict(run: EvalRun): Verdict {
  return run.executionStatus === "error" ? "blocked" : run.verdict;
}

function TypeBadge({ type }: { type: EvalType }) {
  return <span className={`type-badge type-badge--${type}`}>{type.toUpperCase()}</span>;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"} UTC`;
}

function formatDateShort(iso: string) {
  const date = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number") return "—";
  const seconds = Math.round(ms / 1000);
  return seconds > 90 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function formatPassRateThreshold(value?: number) {
  if (value === undefined || value === null) return "Not recorded";
  const percentage = value <= 1 ? value * 100 : value;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

const githubManifestBaseUrl = process.env.NEXT_PUBLIC_GITHUB_MANIFEST_BASE_URL?.trim().replace(/\/+$/, "");

function githubManifestUrl(manifestPath?: string) {
  if (!githubManifestBaseUrl || !manifestPath) return null;
  const encodedPath = manifestPath.split("/").map(encodeURIComponent).join("/");
  return `${githubManifestBaseUrl}/${encodedPath}`;
}

function runScope(run: EvalRun) {
  if (run.evalType === "e2e") {
    return { primary: run.target, secondary: `${run.stage} · live conversation` };
  }
  const skill = run.unitConfig?.skillId ?? run.target;
  return { primary: skill, secondary: `${run.unitConfig?.bsaEnvironment ?? run.stage} · skill v${run.unitConfig?.skillVersion ?? "unknown"} · mock-backed` };
}

function MetricCard({ label, value, note, tone, spark }: { label: string; value: string; note: string; tone: string; spark: number[] }) {
  const values = spark.length ? spark : [0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => `${values.length === 1 ? 45 : index * (90 / (values.length - 1))},${31 - ((value - min) / range) * 22}`).join(" ");
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon--${tone}`}>{tone === "red" ? "!" : tone === "blue" ? "↗" : tone === "violet" ? "◷" : "✓"}</div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      <svg className={`spark spark--${tone}`} viewBox="0 0 90 38" aria-hidden="true"><polyline points={points} /></svg>
    </article>
  );
}

type DailyTrend = { date: string; e2e?: number; unit?: number };

function TrendChart({ points, type }: { points: DailyTrend[]; type: "all" | EvalType }) {
  const width = 660;
  const top = 18;
  const bottom = 180;
  const x = (index: number) => points.length < 2 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (value: number) => top + ((100 - value) / 100) * (bottom - top);
  const line = (evalType: EvalType) => points.flatMap((point, index) => {
    const value = point[evalType];
    return typeof value === "number" ? [`${x(index)},${y(value)}`] : [];
  }).join(" ");
  const labelCount = Math.min(7, points.length);
  const labelIndexes = Array.from({ length: labelCount }, (_, index) => Math.round(index * (points.length - 1) / Math.max(labelCount - 1, 1)));
  const visibleTypes: EvalType[] = type === "all" ? ["e2e", "unit"] : [type];
  const hasData = visibleTypes.some((evalType) => points.some((point) => typeof point[evalType] === "number"));
  return (
    <div className="trend-chart" role="img" aria-label="Pass rate trend for E2E and unit evaluations">
      <div className="chart-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div>
      <svg viewBox="0 0 660 210" preserveAspectRatio="none" aria-hidden="true">
        <g className="grid-lines"><line x1="0" x2="660" y1="18" y2="18"/><line x1="0" x2="660" y1="72" y2="72"/><line x1="0" x2="660" y1="126" y2="126"/><line x1="0" x2="660" y1="180" y2="180"/></g>
        {visibleTypes.map((evalType) => <polyline key={evalType} className={`line line--${evalType}`} points={line(evalType)} />)}
        {visibleTypes.flatMap((evalType) => points.map((point, index) => typeof point[evalType] === "number" ? <circle key={`${evalType}-${point.date}`} className={`trend-dot trend-dot--${evalType}`} cx={x(index)} cy={y(point[evalType]!)} r="3"><title>{`${evalType.toUpperCase()} ${point.date}: ${point[evalType]!.toFixed(1)}%`}</title></circle> : null))}
      </svg>
      {!hasData && <div className="chart-empty">No completed runs in this window</div>}
      <div className="chart-days">{labelIndexes.map((index) => <span key={`${points[index]?.date}-${index}`}>{points[index] ? formatDateShort(`${points[index].date}T00:00:00.000Z`) : ""}</span>)}</div>
    </div>
  );
}

function dateKey(value: string | number | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function summarizeCases(run: EvalRun, items: EvalCase[]): SuiteSummary[] {
  const cases = items.filter((item) => item.runId === run.runId);
  if (!cases.length) return run.suites;
  if (run.evalType === "unit" && cases.some((item) => item.scores && Object.keys(item.scores).length)) {
    const metrics = new Map<string, number[]>();
    cases.forEach((item) => Object.entries(item.scores ?? {}).forEach(([name, score]) => metrics.set(name, [...(metrics.get(name) ?? []), score])));
    return Array.from(metrics.entries()).map(([name, scores]) => ({
      name,
      total: scores.length,
      passed: scores.filter((score) => score >= 4).length,
      failed: scores.filter((score) => score < 4).length,
      meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    }));
  }
  const groups = new Map<string, EvalCase[]>();
  cases.forEach((item) => groups.set(item.suite, [...(groups.get(item.suite) ?? []), item]));
  return Array.from(groups.entries()).map(([name, grouped]) => ({
    name,
    total: grouped.length,
    passed: grouped.filter((item) => item.verdict === "passed" || item.verdict === "xpassed").length,
    failed: grouped.filter((item) => item.verdict !== "passed" && item.verdict !== "xpassed").length,
    meanScore: grouped.reduce((sum, item) => sum + item.score, 0) / grouped.length,
  }));
}

function drilldownRequest(run: EvalRun, kind: DrilldownTrendKind, skill: string, caseId?: string): DrilldownTrendRequest {
  return {
    kind,
    evalType: run.evalType,
    skill,
    caseId,
    stage: run.stage,
    target: run.target,
    environment: run.unitConfig?.bsaEnvironment ?? run.stage,
    sourceRunId: run.runId,
  };
}

function RunsTable({ runs, onOpen }: { runs: EvalRun[]; onOpen: (run: EvalRun) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Type</th><th>Evaluation scope</th><th>Verdict</th><th>Pass rate</th><th>Mean score</th><th>Duration</th><th>Started</th></tr></thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId} tabIndex={0} onClick={() => onOpen(run)} onKeyDown={(event) => event.key === "Enter" && onOpen(run)}>
              <td><button className="run-link" onClick={(event) => { event.stopPropagation(); onOpen(run); }}>{run.runId}</button><small>{run.actor} · {run.trigger}</small></td>
              <td><TypeBadge type={run.evalType} /></td>
              <td><span>{runScope(run).primary}</span><small>{runScope(run).secondary}</small></td>
              <td><StatusBadge verdict={effectiveRunVerdict(run)} /></td>
              <td><div className="rate"><span>{run.summary.passRatePct || "—"}{run.summary.passRatePct ? "%" : ""}</span><i><b style={{ width: `${run.summary.passRatePct}%` }} /></i></div></td>
              <td><strong className="score">{run.summary.meanScore || "—"}</strong><small>{run.summary.total ? `/ 5.0 · ${run.summary.total} cases` : "Waiting"}</small></td>
              <td>{formatDuration(run.durationMs)}</td>
              <td>{formatTime(run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <div className="empty"><strong>No runs found</strong><span>Try changing your filters or search term.</span></div>}
    </div>
  );
}

export default function Home() {
  const RUNS_PAGE_SIZE = 25;
  const api = useMemo(() => configuredEvalApi(), []);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [dataState, setDataState] = useState<DataState>(api ? "connecting" : "unconfigured");
  const [loading, setLoading] = useState(Boolean(api));
  const [apiError, setApiError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [openingRunId, setOpeningRunId] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runCursors, setRunCursors] = useState<Record<EvalType, string | null>>({ e2e: null, unit: null });
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [runPage, setRunPage] = useState(0);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | EvalType>("all");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<"all" | ExecutionStatus>("all");
  const [stage, setStage] = useState("all");
  const [trigger, setTrigger] = useState("all");
  const [actor, setActor] = useState("all");
  const [startedWithin, setStartedWithin] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<DrilldownTrendRequest | null>(null);
  const [historyFocus, setHistoryFocus] = useState<{ type: EvalType; stage?: string; target?: string; skillId?: string; environment?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overviewDays, setOverviewDays] = useState<7 | 30 | 90>(7);
  const [overviewType, setOverviewType] = useState<"all" | EvalType>("all");
  const selectedRun = useMemo(() => selectedRunId ? runs.find((run) => run.runId === selectedRunId) ?? null : null, [runs, selectedRunId]);
  const hasOlderRuns = Boolean(runCursors.e2e || runCursors.unit);

  const navigate = useCallback((nextView: View, runId: string | null = null, replace = false) => {
    setView(nextView);
    setSelectedRunId(nextView === "runs" ? runId : null);
    setSelectedCase(null);
    setSelectedTrend(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextView === "overview") url.searchParams.delete("view");
      else url.searchParams.set("view", nextView);
      if (nextView === "runs" && runId) url.searchParams.set("run", runId);
      else url.searchParams.delete("run");
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("view") as View | null;
      const nextView = navItems.some((item) => item.id === requested) ? requested! : "overview";
      setView(nextView);
      setSelectedRunId(nextView === "runs" ? params.get("run") : null);
      setSelectedCase(null);
      setSelectedTrend(null);
    };
    restoreLocation();
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  const loadRuns = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setApiError(null);
    try {
      const batch = await api.listRunBatch(undefined, 50);
      setRuns(batch.items);
      setRunCursors(batch.nextCursors);
      setRunPage(0);
      setDataState("live");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to load the Eval API");
      setRuns([]);
      setCases([]);
      setRunCursors({ e2e: null, unit: null });
      setDataState("error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api.listRunBatch(undefined, 50, controller.signal).then((batch) => {
      setRuns(batch.items);
      setRunCursors(batch.nextCursors);
      setDataState("live");
      setApiError(null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setApiError(error instanceof Error ? error.message : "Unable to load the Eval API");
      setRuns([]);
      setCases([]);
      setRunCursors({ e2e: null, unit: null });
      setDataState("error");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api]);

  const loadOlderRuns = useCallback(async () => {
    if (!api || !hasOlderRuns || loadingMoreRuns) return 0;
    setLoadingMoreRuns(true);
    try {
      const batch = await api.listRunBatch(runCursors, 50);
      setRunCursors(batch.nextCursors);
      setRuns((current) => {
        const byId = new Map(current.map((run) => [run.runId, run]));
        batch.items.forEach((run) => byId.set(run.runId, run));
        return Array.from(byId.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      });
      return batch.items.length;
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load older runs");
      return 0;
    } finally {
      setLoadingMoreRuns(false);
    }
  }, [api, hasOlderRuns, loadingMoreRuns, runCursors]);

  useEffect(() => {
    if (!selectedRunId || selectedRun || !api || dataState !== "live") return;
    const evalType = selectedRunId.startsWith("unit-") ? "unit" : "e2e";
    const controller = new AbortController();
    void api.getRun(evalType, selectedRunId, controller.signal).then((run) => {
      if (!controller.signal.aborted) setRuns((current) => current.some((item) => item.runId === run.runId) ? current : [run, ...current]);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "Unable to load this run");
    });
    return () => controller.abort();
  }, [api, dataState, selectedRun, selectedRunId]);

  useEffect(() => {
    if (!selectedRun || !api || dataState !== "live") return;
    const controller = new AbortController();
    void api.listCases(selectedRun, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setCases(items.filter((item) => item.runId === selectedRun.runId));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "Unable to load cases");
      });
    return () => controller.abort();
  }, [api, dataState, selectedRun]);

  const filterOptions = useMemo(() => ({
    stages: Array.from(new Set(runs.map((run) => run.stage).filter(Boolean))).sort(),
    triggers: Array.from(new Set(runs.map((run) => run.trigger).filter(Boolean))).sort(),
    actors: Array.from(new Set(runs.map((run) => run.actor).filter(Boolean))).sort(),
  }), [runs]);

  const activeMoreFilterCount = [executionStatus, stage, trigger, actor, startedWithin].filter((value) => value !== "all").length;

  const resetMoreFilters = () => {
    setExecutionStatus("all");
    setStage("all");
    setTrigger("all");
    setActor("all");
    setStartedWithin("all");
  };

  const filteredRuns = useMemo(() => runs.filter((run) => {
    const haystack = `${run.runId} ${run.actor} ${run.stage} ${run.target} ${run.gitSha} ${run.unitConfig?.skillId ?? ""} ${run.unitConfig?.skillVersion ?? ""} ${run.e2eConfig?.selectedSuites.join(" ") ?? ""}`.toLowerCase();
    const hours = startedWithin === "24h" ? 24 : startedWithin === "7d" ? 24 * 7 : startedWithin === "30d" ? 24 * 30 : null;
    const referenceTime = runs.reduce((latest, item) => Math.max(latest, new Date(item.startedAt).getTime()), 0);
    const startedMatches = hours === null || new Date(run.startedAt).getTime() >= referenceTime - hours * 3_600_000;
    return haystack.includes(search.toLowerCase())
      && (type === "all" || run.evalType === type)
      && (verdict === "all" || effectiveRunVerdict(run) === verdict)
      && (executionStatus === "all" || run.executionStatus === executionStatus)
      && (stage === "all" || run.stage === stage)
      && (trigger === "all" || run.trigger === trigger)
      && (actor === "all" || run.actor === actor)
      && startedMatches;
  }), [actor, executionStatus, runs, search, stage, startedWithin, trigger, type, verdict]);
  const runPageCount = Math.max(1, Math.ceil(filteredRuns.length / RUNS_PAGE_SIZE));
  const activeRunPage = Math.min(runPage, runPageCount - 1);
  const visibleRuns = filteredRuns.slice(activeRunPage * RUNS_PAGE_SIZE, (activeRunPage + 1) * RUNS_PAGE_SIZE);
  const visibleStart = filteredRuns.length ? activeRunPage * RUNS_PAGE_SIZE + 1 : 0;
  const visibleEnd = Math.min((activeRunPage + 1) * RUNS_PAGE_SIZE, filteredRuns.length);

  const overview = useMemo(() => {
    const now = runs.reduce((latest, run) => Math.max(latest, new Date(run.startedAt).getTime()), 0);
    const start = now - overviewDays * 86_400_000;
    const inView = runs.filter((run) => {
      const timestamp = new Date(run.startedAt).getTime();
      return timestamp >= start && timestamp <= now && (overviewType === "all" || run.evalType === overviewType);
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const completed = inView.filter((run) => run.executionStatus === "completed");
    const passed = completed.filter((run) => run.verdict === "passed").length;
    const runningRuns = inView.filter((run) => run.executionStatus === "running");
    const queuedRuns = inView.filter((run) => run.executionStatus === "queued");
    const attention = inView.filter((run) => run.verdict === "failed" || run.verdict === "blocked" || run.executionStatus === "error");
    const p95 = percentile(completed.flatMap((run) => typeof run.durationMs === "number" ? [run.durationMs] : []), .95);
    const daily = Array.from({ length: overviewDays }, (_, index) => {
      const date = new Date(now - (overviewDays - 1 - index) * 86_400_000);
      return { date: dateKey(date), e2e: undefined, unit: undefined } as DailyTrend;
    });
    const dailyByType = (evalType: EvalType) => daily.map((day) => {
      const dayRuns = completed.filter((run) => run.evalType === evalType && dateKey(run.startedAt) === day.date);
      const total = dayRuns.reduce((sum, run) => sum + run.summary.total, 0);
      return total ? dayRuns.reduce((sum, run) => sum + run.summary.passed, 0) / total * 100 : undefined;
    });
    const e2eDaily = dailyByType("e2e");
    const unitDaily = dailyByType("unit");
    daily.forEach((day, index) => { day.e2e = e2eDaily[index]; day.unit = unitDaily[index]; });
    const recentDays = daily.slice(-Math.min(7, daily.length));
    const dailyCount = (predicate: (run: EvalRun) => boolean) => recentDays.map((day) => inView.filter((run) => dateKey(run.startedAt) === day.date && predicate(run)).length);
    const dailyDuration = recentDays.map((day) => percentile(completed.filter((run) => dateKey(run.startedAt) === day.date).flatMap((run) => run.durationMs ? [run.durationMs] : []), .95));
    const passSpark = recentDays.map((day) => {
      const values = [day.e2e, day.unit].filter((value): value is number => typeof value === "number");
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    });
    return { inView, completed, passed, runningRuns, queuedRuns, attention, p95, daily, passSpark, failureSpark: dailyCount((run) => run.verdict === "failed" || run.verdict === "blocked" || run.executionStatus === "error"), progressSpark: dailyCount((run) => run.executionStatus === "running" || run.executionStatus === "queued"), durationSpark: dailyDuration };
  }, [overviewDays, overviewType, runs]);

  const openRun = (run: EvalRun) => {
    setCases([]);
    setSelectedCase(null);
    setSelectedTrend(null);
    setDetailError(null);
    navigate("runs", run.runId);
  };

  const openRunById = async (runId: string, evalType: EvalType) => {
    const loaded = runs.find((run) => run.runId === runId);
    if (!api || dataState !== "live") {
      if (loaded) openRun(loaded);
      return;
    }
    setOpeningRunId(runId);
    setDetailError(null);
    try {
      const run = await api.getRun(evalType, runId);
      setRuns((current) => current.some((item) => item.runId === run.runId)
        ? current.map((item) => item.runId === run.runId ? run : item)
        : [run, ...current]);
      openRun(run);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load this source run");
    } finally {
      setOpeningRunId(null);
    }
  };

  const openHistory = (run: EvalRun) => {
    setHistoryFocus(run.evalType === "e2e"
      ? { type: "e2e", stage: run.stage, target: run.target }
      : { type: "unit", skillId: run.unitConfig?.skillId ?? run.target, environment: run.unitConfig?.bsaEnvironment ?? run.stage });
    navigate("history");
  };

  const openTrend = (request: DrilldownTrendRequest) => {
    setSelectedCase(null);
    setSelectedTrend(request);
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><b aria-hidden="true">UKG</b><Image className="brand-logo" src="/ukg-rgb.png" alt="UKG" width={52} height={34} unoptimized onError={(event) => { event.currentTarget.style.display = "none"; }} /></span><div><strong>EvalHub</strong><small>Quality operations</small></div>{sidebarOpen && <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>×</button>}</div>
        <nav aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { navigate(item.id); if (item.id === "history") setHistoryFocus(null); setSidebarOpen(false); }}><span>{item.glyph}</span>{item.label}</button>)}
          <p>Manage</p>
          <button disabled title="Policy management is planned"><span>⌁</span>Policies<b className="nav-soon">soon</b></button>
          <button disabled title="Metric management is planned"><span>✣</span>Custom metrics<b className="nav-soon">soon</b></button>
        </nav>
        <div className={`sidebar-note sidebar-note--${dataState}`}><span>Data status</span><strong><i /> {dataState === "live" ? "Live API connected" : dataState === "connecting" ? "Connecting to API" : dataState === "error" ? "API unavailable" : "API not configured"}</strong><small>FastAPI · MongoDB · read only</small></div>
        <div className="profile"><span>AK</span><div><strong>Artem Kovtunenko</strong><small>Evaluation operator</small></div><b>•••</b></div>
      </aside>

      <main className="main">
        <header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button><div className="breadcrumb">Evaluation framework <span>/</span> {navItems.find((item) => item.id === view)?.label} <span>·</span> {dataState === "live" ? "Live MongoDB" : dataState === "connecting" ? "Connecting" : "No live data"}</div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<i /></button><button className="primary-button" onClick={() => void loadRuns()} disabled={!api || loading}>{loading ? "Refreshing…" : "↻ Refresh data"}</button></div></header>

        <div className="content">
          {view === "overview" && <>
            <div className="page-heading"><div><span className="eyebrow">Evaluation health</span><h1>Good morning, Artem</h1><p>Live run health for the selected evaluation type and time window.</p></div><div className="overview-filters"><div className="type-switch" aria-label="Overview evaluation type"><button className={overviewType === "all" ? "active" : ""} onClick={() => setOverviewType("all")}>All evaluations</button><button className={overviewType === "e2e" ? "active" : ""} onClick={() => setOverviewType("e2e")}>E2E</button><button className={overviewType === "unit" ? "active" : ""} onClick={() => setOverviewType("unit")}>Unit</button></div><div className="time-filter" aria-label="Overview time window">{([7, 30, 90] as const).map((days) => <button key={days} className={overviewDays === days ? "selected" : ""} onClick={() => setOverviewDays(days)}>{days} days</button>)}</div></div></div>
            <section className="metrics-grid">
              <MetricCard label="Gate pass rate" value={overview.completed.length ? `${Math.round((overview.passed / overview.completed.length) * 100)}%` : "—"} note={`${overview.passed} passed · ${overview.completed.length} completed`} tone="green" spark={overview.passSpark} />
              <MetricCard label="Runs in progress" value={String(overview.runningRuns.length + overview.queuedRuns.length)} note={`${overview.runningRuns.length} running · ${overview.queuedRuns.length} queued`} tone="blue" spark={overview.progressSpark} />
              <MetricCard label="Failed or blocked" value={String(overview.attention.length)} note={`${overview.attention.length} need attention`} tone="red" spark={overview.failureSpark} />
              <MetricCard label="P95 duration" value={overview.p95 ? formatDuration(overview.p95) : "—"} note={`${overview.completed.filter((run) => run.durationMs).length} timed completed runs`} tone="violet" spark={overview.durationSpark} />
            </section>
            <section className="dashboard-grid">
              <article className="panel trend-panel"><div className="panel-heading"><div><h2>Pass rate trend</h2><p>Case-weighted daily result from completed live runs</p></div><div className="legend">{overviewType !== "unit" && <span><i className="e2e-dot" />E2E</span>}{overviewType !== "e2e" && <span><i className="unit-dot" />Unit</span>}</div></div><TrendChart points={overview.daily} type={overviewType} /></article>
              <article className="panel attention-panel"><div className="panel-heading"><div><h2>Needs attention</h2><p>Failures, blocks and execution errors in view</p></div><button onClick={() => { setType(overviewType); setVerdict("all"); navigate("runs"); }}>View all</button></div>
                <div className="attention-list">
                  {overview.attention.slice(0, 4).map((run) => <button key={run.runId} onClick={() => openRun(run)}><span className={`alert-icon ${run.executionStatus === "error" || run.verdict === "blocked" ? "blocked" : ""}`}>{run.executionStatus === "error" || run.verdict === "blocked" ? "×" : "!"}</span><div><strong>{runScope(run).primary}</strong><small>{run.runId} · {run.evalType.toUpperCase()}</small></div><b>{run.executionStatus === "error" ? "Error" : `${run.summary.passRatePct}%`}</b></button>)}
                  {!overview.attention.length && <div className="attention-empty"><strong>No failures in view</strong><span>Completed runs in this window do not need attention.</span></div>}
                </div>
              </article>
            </section>
            <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent evaluation runs</h2><p>Latest activity matching the selected dashboard scope</p></div><button className="text-button" onClick={() => { setType(overviewType); navigate("runs"); }}>View all runs →</button></div><RunsTable runs={overview.inView.slice(0, 5)} onOpen={openRun} /></section>
          </>}

          {view === "runs" && <>
            <div className="page-heading compact"><div><span className="eyebrow">Operations</span><h1>{selectedRun ? selectedRun.runId : "Evaluation runs"}</h1><p>{selectedRun ? "Run result, suite breakdown and case-level evidence." : "Search, filter and inspect every E2E and unit evaluation."}</p></div>{selectedRun && <button className="secondary-button" onClick={() => navigate("runs")}>← All runs</button>}</div>
            {!selectedRun ? <section className="panel runs-panel">
              <div className="filter-bar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setRunPage(0); }} placeholder="Search run, actor, SHA or target…" /></label><select value={type} onChange={(event) => { setType(event.target.value as "all" | EvalType); setRunPage(0); }} aria-label="Evaluation type"><option value="all">All types</option><option value="e2e">E2E</option><option value="unit">Unit</option></select><select value={verdict} onChange={(event) => { setVerdict(event.target.value as "all" | Verdict); setRunPage(0); }} aria-label="Verdict"><option value="all">All verdicts</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="blocked">Blocked</option><option value="xpassed">XPASS</option><option value="pending">Pending</option></select><button className={`filter-button ${moreFiltersOpen || activeMoreFilterCount ? "active" : ""}`} aria-expanded={moreFiltersOpen} aria-controls="advanced-run-filters" onClick={() => setMoreFiltersOpen((open) => !open)}>☷ More filters{activeMoreFilterCount ? ` (${activeMoreFilterCount})` : ""}</button></div>
              {moreFiltersOpen && <div className="advanced-filters" id="advanced-run-filters"><label><span>Execution status</span><select value={executionStatus} onChange={(event) => setExecutionStatus(event.target.value as "all" | ExecutionStatus)}><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="error">Error</option><option value="cancelled">Cancelled</option></select></label><label><span>Stage / environment</span><select value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">All stages</option>{filterOptions.stages.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Trigger</span><select value={trigger} onChange={(event) => setTrigger(event.target.value)}><option value="all">All triggers</option>{filterOptions.triggers.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Actor</span><select value={actor} onChange={(event) => setActor(event.target.value)}><option value="all">All actors</option>{filterOptions.actors.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Started</span><select value={startedWithin} onChange={(event) => setStartedWithin(event.target.value as typeof startedWithin)}><option value="all">Any time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label><div className="advanced-filter-actions"><span>{activeMoreFilterCount ? `${activeMoreFilterCount} advanced filter${activeMoreFilterCount === 1 ? "" : "s"} active` : "No advanced filters active"}</span><button type="button" onClick={resetMoreFilters} disabled={!activeMoreFilterCount}>Clear advanced filters</button></div></div>}
              <RunsTable runs={visibleRuns} onOpen={openRun} />
              <div className="table-footer"><span>Showing {visibleStart}–{visibleEnd} of {filteredRuns.length} matching · {runs.length} loaded{hasOlderRuns ? " · older runs available" : " · all available runs loaded"}</span><div><button disabled={activeRunPage === 0} onClick={() => setRunPage(Math.max(0, activeRunPage - 1))}>←</button><button className="current" aria-label={`Page ${activeRunPage + 1} of ${runPageCount}`}>{activeRunPage + 1}</button><button disabled={loadingMoreRuns || (activeRunPage + 1 >= runPageCount && !hasOlderRuns)} onClick={() => { if (activeRunPage + 1 < runPageCount) setRunPage(activeRunPage + 1); else void loadOlderRuns().then((loaded) => { if (loaded) setRunPage(activeRunPage + 1); }); }}>{loadingMoreRuns ? "…" : "→"}</button></div></div>
            </section> : <RunSummary run={selectedRun} cases={cases} onCase={setSelectedCase} onHistory={openHistory} onTrend={openTrend} />}
          </>}

          {dataState === "unconfigured" && <div className="toast toast--error"><span>!</span>Eval API is not configured. Set NEXT_PUBLIC_EVAL_API_URL to load dashboard data.</div>}
          {apiError && <div className="toast toast--error"><span>!</span>{apiError} · no dashboard data is being substituted</div>}
          {detailError && <div className="toast toast--error"><span>!</span>{detailError} · no cross-run fallback was used</div>}
          {view === "history" && <HistoryView initialFocus={historyFocus} runs={runs} openingRunId={openingRunId} onOpenRun={(runId, evalType) => void openRunById(runId, evalType)} />}
          {view === "compare" && <CompareView runs={runs} api={api} onError={setDetailError} />}
          {view === "schema" && <SchemaView />}
        </div>
      </main>
      {selectedCase && selectedRun && <CaseDrawer item={selectedCase} run={selectedRun} onClose={() => setSelectedCase(null)} onTrend={openTrend} />}
      {selectedTrend && <DrilldownTrendDrawer request={selectedTrend} api={api} onClose={() => setSelectedTrend(null)} onOpenRun={(runId) => void openRunById(runId, selectedTrend.evalType)} />}
    </div>
  );
}

function RunSummary({ run, cases, onCase, onHistory, onTrend }: { run: EvalRun; cases: EvalCase[]; onCase: (item: EvalCase) => void; onHistory: (run: EvalRun) => void; onTrend: (request: DrilldownTrendRequest) => void }) {
  const scope = runScope(run);
  const scopedCases = cases.filter((item) => item.runId === run.runId);
  const suites = summarizeCases(run, scopedCases);
  const manifestUrl = run.evalType === "e2e" ? githubManifestUrl(run.datasetVersion) : null;
  return <>
    <div className="detail-grid">
      <section className="panel run-hero"><div><TypeBadge type={run.evalType} /><StatusBadge verdict={effectiveRunVerdict(run)} /><span className={`execution execution--${run.executionStatus}`}>{run.executionStatus}</span></div><h2>{scope.primary}</h2><p>{scope.secondary} · triggered by <strong>{run.actor}</strong> through {run.trigger.toUpperCase()} · {run.evalType === "e2e" ? <>target manifest {manifestUrl ? <a className="manifest-link" href={manifestUrl} target="_blank" rel="noopener noreferrer">{run.datasetVersion} ↗</a> : <span title="Set NEXT_PUBLIC_GITHUB_MANIFEST_BASE_URL to enable this link">{run.datasetVersion}</span>}</> : `evalset ${run.datasetVersion}`}</p>{run.evalType === "e2e" ? <div className="scope-chips"><span>Live target</span><span>No tool mocks</span><span>{run.e2eConfig?.selectedSuites.length ?? run.suites.length} suites</span><span>Target gate ≥ {formatPassRateThreshold(run.e2eConfig?.passRateThreshold)}</span><span>Max tier {run.e2eConfig?.maxTier ?? "not recorded"}</span></div> : <div className="scope-chips unit"><span>{run.unitConfig?.mode ?? "all"} turns</span><span>Per-skill mocks</span><span>Tool + response quality</span></div>}<button className="history-link" onClick={() => onHistory(run)}>View {run.evalType === "e2e" ? "target" : "skill"} history →</button><div className="detail-stats"><span><small>Pass rate</small><strong>{run.summary.passRatePct || "—"}{run.summary.passRatePct ? "%" : ""}</strong>{run.evalType === "e2e" && <em>Required: {formatPassRateThreshold(run.e2eConfig?.passRateThreshold)}</em>}</span><span><small>Mean score</small><strong>{run.summary.meanScore || "—"}</strong></span><span><small>Cases</small><strong>{run.summary.total}</strong></span><span><small>Duration</small><strong>{formatDuration(run.durationMs)}</strong></span></div></section>
      <section className="panel suite-panel"><div className="panel-heading"><div><h2>{run.evalType === "e2e" ? "Suite breakdown" : "Skill / metric breakdown"}</h2><p>{run.evalType === "e2e" ? "Live conversation result by enabled suite" : "Mock-backed cases scored for this single skill"}</p></div></div>{suites.length ? suites.map((suite) => <div className="suite-row" key={suite.name}><div><strong>{suite.name}</strong><small>{suite.total ? `${suite.passed} passed · ${suite.failed} failed` : "Enabled suite · case results not available"}</small></div><div className="suite-bar"><i><b style={{ width: `${(suite.passed / Math.max(suite.total, 1)) * 100}%` }} /></i><span>{suite.total ? suite.meanScore.toFixed(2) : "—"}</span></div><button className="trend-action" onClick={() => onTrend(drilldownRequest(run, "skill", run.evalType === "unit" ? (run.unitConfig?.skillId ?? run.target) : suite.name))}>View trend</button></div>) : <div className="empty compact-empty"><strong>No results yet</strong><span>This run has not produced suite results.</span></div>}</section>
    </div>
    <section className="panel cases-panel"><div className="panel-heading"><div><h2>Evaluated cases</h2><p>Case-level verdicts, evidence and latency</p></div><span className="result-count">{scopedCases.length} results</span></div>
      {scopedCases.length ? <div className="table-wrap"><table className="cases-table"><thead><tr><th>Case</th><th>Suite</th><th>Verdict</th><th>Score</th><th>Threshold</th><th>Latency</th><th /></tr></thead><tbody>{scopedCases.map((item) => <tr key={item.caseId} onClick={() => onCase(item)}><td><button className="run-link">{item.caseId}</button><small>{item.role} · tier {item.tier}</small></td><td>{item.suite}</td><td><StatusBadge verdict={item.verdict === "error" ? "blocked" : item.verdict} /></td><td><strong className={item.score < item.threshold ? "bad-score" : "score"}>{item.score.toFixed(1)}</strong></td><td>{item.threshold.toFixed(1)}</td><td>{(item.responseTimeMs / 1000).toFixed(1)}s</td><td><button className="row-arrow" aria-label={`Open ${item.caseId}`}>›</button></td></tr>)}</tbody></table></div> : <div className="empty"><strong>No case documents available</strong><span>No cases matching run {run.runId} were returned.</span></div>}
    </section>
  </>;
}

function CaseDrawer({ item, run, onClose, onTrend }: { item: EvalCase; run: EvalRun; onClose: () => void; onTrend: (request: DrilldownTrendRequest) => void }) {
  const prompt = item.input ?? "Not captured in this run result. The prompt remains defined in the authored stage suite.";
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`Evaluation case ${item.caseId}`}><button className="drawer-backdrop" onClick={onClose} aria-label="Close case detail" /><aside className="case-drawer"><header><div><span className="eyebrow">Case evidence</span><h2>{item.caseId}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body"><button className="case-trend-button" onClick={() => onTrend(drilldownRequest(run, "case", item.skill || item.suite, item.caseId))}>↗ View this case over time</button><div className="case-summary"><StatusBadge verdict={item.verdict === "error" ? "blocked" : item.verdict} /><span>Score <strong>{item.score.toFixed(1)}</strong> / case threshold {item.threshold.toFixed(1)}</span><span>{item.responseTimeMs ? `${(item.responseTimeMs / 1000).toFixed(2)}s` : "unit case"}</span></div>{item.verdict === "xpassed" && <div className="xpass-note"><strong>Unexpected pass</strong><span>This case is marked as a known or expected failure, but it passed. Review the known-bug marker and linked issue; the expected-failure annotation may now be stale.</span></div>}<dl className="meta-grid"><div><dt>Suite</dt><dd>{item.suite}</dd></div><div><dt>Role / type</dt><dd>{item.role}</dd></div><div><dt>Tier</dt><dd>{item.tier || "—"}</dd></div><div><dt>Skill</dt><dd>{item.skill}</dd></div></dl><EvidenceBlock title={item.scores ? "Test input" : "User prompt"} content={prompt} tone={item.input ? "default" : "muted"} /><EvidenceBlock title="Assistant response" content={item.responseText || "No response stored"} />{item.scores && <EvidenceBlock title="Unit metric scores" content={JSON.stringify(item.scores, null, 2)} tone={item.verdict === "failed" ? "danger" : "default"} />}{item.toolCalls?.length ? <EvidenceBlock title="Observed tool calls" content={JSON.stringify(item.toolCalls, null, 2)} /> : null}<EvidenceBlock title="Judge explanation" content={item.explanation} tone={item.verdict === "failed" ? "danger" : "default"} />{item.bugRef && <div className="bug-ref"><span>Linked issue</span><strong>{item.bugRef}</strong></div>}{item.error && <EvidenceBlock title="Execution error" content={item.error} tone="danger" />}</div></aside></div>;
}

function EvidenceBlock({ title, content, tone = "default" }: { title: string; content: string; tone?: "default" | "danger" | "muted" }) {
  return <section className={`evidence evidence--${tone}`}><h3>{title}</h3><p>{content}</p></section>;
}

function DrilldownScoreChart({ points, onOpenRun }: { points: DrilldownTrendPoint[]; onOpenRun: (runId: string) => void }) {
  const width = 760;
  const left = 42;
  const right = 728;
  const top = 22;
  const bottom = 178;
  const x = (index: number) => points.length < 2 ? (left + right) / 2 : left + index / (points.length - 1) * (right - left);
  const y = (score: number) => top + (5 - score) / 5 * (bottom - top);
  const scoreLine = points.map((point, index) => `${x(index)},${y(point.score)}`).join(" ");
  const thresholdLine = points.map((point, index) => `${x(index)},${y(point.threshold)}`).join(" ");
  return <div className="drilldown-chart" role="img" aria-label="Score and threshold over time"><svg viewBox={`0 0 ${width} 218`} preserveAspectRatio="none"><g className="drilldown-grid">{[5,4,3,2,1,0].map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} /><text x="12" y={y(value)+3}>{value}</text></g>)}</g>{points.length > 1 && <><polyline className="drilldown-threshold-line" points={thresholdLine} /><polyline className="drilldown-score-line" points={scoreLine} /></>}{points.map((point, index) => <g className="drilldown-point" key={`${point.runId}-${point.startedAt}`} onClick={() => onOpenRun(point.runId)} role="button"><circle className={`drilldown-dot drilldown-dot--${point.verdict}`} cx={x(index)} cy={y(point.score)} r="5"><title>{`${formatTime(point.startedAt)} · score ${point.score.toFixed(2)} · ${point.verdict}`}</title></circle><text className="drilldown-value" x={x(index)} y={Math.max(12, y(point.score)-11)} textAnchor="middle">{point.score.toFixed(1)}</text><text className="point-date" x={x(index)} y="207" textAnchor="middle">{formatDateShort(point.startedAt)}</text></g>)}</svg></div>;
}

function DrilldownTrendDrawer({ request, api, onClose, onOpenRun }: { request: DrilldownTrendRequest; api: EvalApi | null; onClose: () => void; onOpenRun: (runId: string) => void }) {
  const [points, setPoints] = useState<DrilldownTrendPoint[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
      setNextCursor(null);
      setPoints([]);
      if (!api) throw new Error("Eval API is not configured. Trend data is unavailable.");
      return api.listTrend(request, null, 30, controller.signal);
    }).then((page) => {
      if (controller.signal.aborted || !page) return;
      setPoints(page.items.sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load trend data");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api, request]);
  const loadOlder = async () => {
    if (!api || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const page = await api.listTrend(request, nextCursor, 30);
      setNextCursor(page.nextCursor);
      setPoints((current) => {
        const byRun = new Map(current.map((point) => [point.runId, point]));
        page.items.forEach((point) => byRun.set(point.runId, point));
        return Array.from(byRun.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load older trend data");
    } finally {
      setLoadingOlder(false);
    }
  };
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const delta = latest && previous ? latest.score - previous.score : 0;
  const nonPasses = points.filter((point) => point.verdict !== "passed" && point.verdict !== "xpassed").length;
  const title = request.kind === "case" ? request.caseId : request.skill;
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`${title} historical trend`}><button className="drawer-backdrop" onClick={onClose} aria-label="Close trend" /><aside className="case-drawer trend-drawer"><header><div><span className="eyebrow">{request.kind === "case" ? "Case history" : "Skill trend"}</span><h2>{title}</h2><p><TypeBadge type={request.evalType} /> {request.evalType === "e2e" ? `${request.stage} · ${request.target}` : `${request.environment} · ${request.skill}`}</p></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body">{loading ? <div className="trend-loading"><span /><span /><span />Loading historical cases…</div> : error && !points.length ? <div className="trend-error"><strong>Trend could not be loaded</strong><span>{error}</span></div> : points.length ? <><div className="trend-kpis"><article><span>Latest score</span><strong>{latest?.score.toFixed(2)}</strong><small>threshold {latest?.threshold.toFixed(2)}</small></article><article><span>Change</span><strong className={delta >= 0 ? "delta-good" : "delta-bad"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}</strong><small>vs previous matching run</small></article><article><span>History loaded</span><strong>{points.length}</strong><small>{nonPasses} failed or blocked</small></article></div><section className="trend-chart-card"><div className="trend-chart-heading"><div><h3>Score over time</h3><p>Matching {request.evalType === "e2e" ? "stage, target and suite" : "environment and skill"}; points open the source run.</p></div><div className="drilldown-legend"><span><i />Score</span><span><i />Threshold</span></div></div><DrilldownScoreChart points={points} onOpenRun={onOpenRun} /></section><div className="trend-table-wrap"><table><thead><tr><th>Run</th><th>{request.evalType === "unit" ? "Skill version" : "Dataset"}</th><th>Verdict</th><th>Score / gate</th><th>Started</th></tr></thead><tbody>{[...points].reverse().map((point) => <tr key={`${point.runId}-${point.startedAt}`} onClick={() => onOpenRun(point.runId)}><td><button className="run-link">{point.runId}</button></td><td>{request.evalType === "unit" ? `v${point.skillVersion ?? "unknown"} · BSA ${point.bsaVersion ?? "unknown"}` : point.datasetVersion}</td><td><StatusBadge verdict={point.verdict} /></td><td><strong>{point.score.toFixed(2)}</strong> / {point.threshold.toFixed(2)}</td><td>{formatTime(point.startedAt)}</td></tr>)}</tbody></table></div>{error && <div className="trend-error"><span>{error}</span></div>}{nextCursor && <button className="secondary-button trend-load-more" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading older runs…" : "Load 30 older matching runs"}</button>}</> : <div className="trend-empty"><strong>No matching history yet</strong><span>This view keeps {request.evalType === "e2e" ? "E2E target" : "unit environment"} results separate. More completed matching runs are needed before a trend can be drawn.</span>{nextCursor && <button className="secondary-button" onClick={() => void loadOlder()}>Search older runs</button>}</div>}</div></aside></div>;
}

type HistoryFocus = { type: EvalType; stage?: string; target?: string; skillId?: string; environment?: string } | null;
type TrendPoint = { id: string; startedAt: string; passRatePct: number; meanScore: number; totalCases: number; durationMs: number; verdict: Verdict; scope: string; batchId?: string };

function aggregateE2E(points: E2EHistoryPoint[]): TrendPoint[] {
  const groups = new Map<string, E2EHistoryPoint[]>();
  points.forEach((point) => {
    const batchId = point.batchId ?? point.runId;
    groups.set(batchId, [...(groups.get(batchId) ?? []), point]);
  });
  return Array.from(groups.entries()).map(([batchId, items]) => {
    const totalCases = items.reduce((sum, item) => sum + item.totalCases, 0);
    const weighted = (key: "passRatePct" | "meanScore") => totalCases ? items.reduce((sum, item) => sum + item[key] * item.totalCases, 0) / totalCases : 0;
    const passRatePct = weighted("passRatePct");
    const verdict: Verdict = passRatePct >= 90 ? "passed" : "failed";
    return { id: batchId, batchId, startedAt: items[0].startedAt, passRatePct, meanScore: weighted("meanScore"), totalCases, durationMs: Math.max(...items.map((item) => item.durationMs)), verdict, scope: `${items.length} targets` };
  }).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function HistoryChart({ points, title, windowDays, windowEnd }: { points: TrendPoint[]; title: string; windowDays: 7 | 30 | 90; windowEnd: number }) {
  const width = 760;
  const plotLeft = 46;
  const plotRight = 730;
  const plotTop = 22;
  const plotBottom = 182;
  const windowStart = windowEnd - windowDays * 86_400_000;
  const windowDuration = Math.max(windowEnd - windowStart, 1);
  const x = (startedAt: string) => {
    const timestamp = new Date(startedAt).getTime();
    const progress = Math.min(1, Math.max(0, (timestamp - windowStart) / windowDuration));
    return plotLeft + progress * (plotRight - plotLeft);
  };
  const y = (percent: number) => plotTop + ((100 - percent) / 100) * (plotBottom - plotTop);
  const passPoints = points.map((point) => `${x(point.startedAt)},${y(point.passRatePct)}`).join(" ");
  const scorePoints = points.map((point) => `${x(point.startedAt)},${y((point.meanScore / 5) * 100)}`).join(" ");
  const dateTicks = Array.from({ length: 7 }, (_, index) => {
    const timestamp = windowStart + (index / 6) * windowDuration;
    return { timestamp, x: plotLeft + (index / 6) * (plotRight - plotLeft) };
  });
  return <section className="panel history-chart-card"><div className="panel-heading"><div><h2>{title}</h2><p>Pass rate and normalized mean score across the selected {windowDays}-day window</p></div><div className="history-legend"><span><i />Pass rate</span><span><i />Mean score</span><span><i />90% gate</span></div></div><div className="history-chart" role="img" aria-label={`${title} ${windowDays}-day historical trend`}><svg viewBox={`0 0 ${width} 230`} preserveAspectRatio="none"><g className="history-grid">{[100,75,50,25,0].map((value) => <g key={value}><line x1={plotLeft} x2={plotRight} y1={y(value)} y2={y(value)}/><text x="7" y={y(value)+3}>{value}%</text></g>)}</g><line className="gate-line" x1={plotLeft} x2={plotRight} y1={y(90)} y2={y(90)}/>{points.length > 1 && <><polyline className="history-pass-line" points={passPoints}/><polyline className="history-score-line" points={scorePoints}/></>}{points.map((point) => <g key={point.id}><circle className="history-pass-dot" cx={x(point.startedAt)} cy={y(point.passRatePct)} r="4"><title>{point.passRatePct.toFixed(1)}% pass rate · {formatTime(point.startedAt)}</title></circle><circle className="history-score-dot" cx={x(point.startedAt)} cy={y((point.meanScore/5)*100)} r="3"><title>{point.meanScore.toFixed(2)} mean score · {formatTime(point.startedAt)}</title></circle><text className="point-value" x={x(point.startedAt)} y={Math.max(12,y(point.passRatePct)-10)} textAnchor="middle">{point.passRatePct.toFixed(point.passRatePct % 1 ? 1 : 0)}%</text></g>)}{dateTicks.map((tick) => <text key={tick.timestamp} className="point-date" x={tick.x} y="211" textAnchor="middle">{formatDateShort(new Date(tick.timestamp).toISOString())}</text>)}</svg></div></section>;
}

function HistoryView({ initialFocus, runs, openingRunId, onOpenRun }: { initialFocus: HistoryFocus; runs: EvalRun[]; openingRunId: string | null; onOpenRun: (runId: string, evalType: EvalType) => void }) {
  const e2eSource = runs.filter((run) => run.evalType === "e2e" && run.executionStatus === "completed").map((run) => ({ runId: run.runId, batchId: run.batchId ?? run.runId, startedAt: run.startedAt, stage: run.stage, target: run.target, passRatePct: run.summary.passRatePct, meanScore: run.summary.meanScore, totalCases: run.summary.total, durationMs: run.durationMs ?? 0, verdict: run.verdict }));
  const unitSource = runs.filter((run) => run.evalType === "unit" && run.executionStatus === "completed").map((run) => ({ runId: run.runId, batchId: run.batchId, startedAt: run.startedAt, skillId: run.unitConfig?.skillId ?? run.target, environment: run.unitConfig?.bsaEnvironment ?? run.stage, passRatePct: run.summary.passRatePct, meanScore: run.summary.meanScore, generalQuality: 0, toolUseQuality: 0, totalCases: run.summary.total, durationMs: run.durationMs ?? 0, verdict: run.verdict }));
  const stages = Array.from(new Set(e2eSource.map((point) => point.stage)));
  const skills = Array.from(new Set(unitSource.map((point) => point.skillId)));
  const initialStage = initialFocus?.stage && stages.includes(initialFocus.stage) ? initialFocus.stage : (stages[0] ?? "");
  const initialSkill = initialFocus?.skillId && skills.includes(initialFocus.skillId) ? initialFocus.skillId : (skills[0] ?? "");
  const [historyType, setHistoryType] = useState<EvalType>(initialFocus?.type ?? "e2e");
  const [stage, setStage] = useState(initialStage);
  const stageTargets = Array.from(new Set(e2eSource.filter((point) => point.stage === stage).map((point) => point.target)));
  const [target, setTarget] = useState(initialFocus?.target && stageTargets.includes(initialFocus.target) ? initialFocus.target : "all");
  const [skillId, setSkillId] = useState(initialSkill);
  const [environment, setEnvironment] = useState(initialFocus?.environment ?? "all");
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");

  const rangeDays: 7 | 30 | 90 = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const referenceTime = runs.reduce(
    (latest, run) => Math.max(latest, new Date(run.startedAt).getTime()),
    0,
  );
  const rangeStart = referenceTime - rangeDays * 86_400_000;
  const inRange = (startedAt: string) => {
    const timestamp = new Date(startedAt).getTime();
    return referenceTime > 0 && timestamp >= rangeStart && timestamp <= referenceTime;
  };

  const e2eStageInRange = e2eSource.filter((point) => inRange(point.startedAt) && point.stage === stage);
  const e2eFiltered = e2eStageInRange.filter((point) => target === "all" || point.target === target);
  const e2eTrend: TrendPoint[] = target === "all" ? aggregateE2E(e2eFiltered) : e2eFiltered.map((point) => ({ id: point.runId, startedAt: point.startedAt, passRatePct: point.passRatePct, meanScore: point.meanScore, totalCases: point.totalCases, durationMs: point.durationMs, verdict: point.verdict, scope: point.target, batchId: point.batchId })).sort((a,b) => a.startedAt.localeCompare(b.startedAt));
  const unitFiltered = unitSource.filter((point) => inRange(point.startedAt) && point.skillId === skillId && (environment === "all" || point.environment === environment)).sort((a,b) => a.startedAt.localeCompare(b.startedAt));
  const unitTrend: TrendPoint[] = unitFiltered.map((point) => ({ id: point.runId, startedAt: point.startedAt, passRatePct: point.passRatePct, meanScore: point.meanScore, totalCases: point.totalCases, durationMs: point.durationMs, verdict: point.verdict, scope: point.environment, batchId: point.batchId }));
  const trend = historyType === "e2e" ? e2eTrend : unitTrend;
  const latest = trend.at(-1);
  const previous = trend.at(-2);
  const passDelta = latest && previous ? latest.passRatePct - previous.passRatePct : 0;
  const latestUnit = unitFiltered.at(-1);
  const selectedSkill = { id: skillId, label: skillId };
  const latestByTarget = stageTargets
    .map((targetId) => e2eStageInRange.filter((point) => point.target === targetId).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).at(-1))
    .filter((point): point is E2EHistoryPoint => Boolean(point));
  const isBatchRollup = historyType === "e2e" && target === "all";

  const openHistoryRun = (runId: string) => {
    if (!isBatchRollup && openingRunId !== runId) onOpenRun(runId, historyType);
  };

  return <>
    <div className="page-heading history-heading"><div><span className="eyebrow">Longitudinal quality</span><h1>Evaluation history</h1><p>Track the same E2E target or unit skill across runs without mixing their scopes.</p></div><div className="type-switch"><button className={historyType === "e2e" ? "active" : ""} onClick={() => setHistoryType("e2e")}>E2E history</button><button className={historyType === "unit" ? "active" : ""} onClick={() => setHistoryType("unit")}>Unit skill history</button></div></div>
    <section className="panel history-controls"><div className="history-control-copy"><TypeBadge type={historyType}/><div><strong>{historyType === "e2e" ? "Target-scoped history" : "Skill-scoped history"}</strong><small>{historyType === "e2e" ? "Stage rollups are case-weighted across fan-out targets." : "Every unit run belongs to exactly one skill and one skill version."}</small></div></div>{historyType === "e2e" ? <><label><span>Stage</span><select aria-label="History stage" value={stage} onChange={(event) => { setStage(event.target.value); setTarget("all"); }}>
      {stages.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Target</span><select aria-label="History target" value={target} onChange={(event) => setTarget(event.target.value)}><option value="all">All targets · stage rollup</option>{stageTargets.map((value) => <option key={value}>{value}</option>)}</select></label></> : <><label><span>Skill</span><select aria-label="History skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Environment</span><select aria-label="History environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="all">All environments</option><option value="staging">Staging BSA</option><option value="dev">Development BSA</option></select></label></>}<div className="range-switch"><button className={range === "7d" ? "active" : ""} onClick={() => setRange("7d")}>7d</button><button className={range === "30d" ? "active" : ""} onClick={() => setRange("30d")}>30d</button><button className={range === "90d" ? "active" : ""} onClick={() => setRange("90d")}>90d</button></div></section>
    <section className="history-metrics"><article className="panel"><span>Latest pass rate</span><strong>{latest?.passRatePct.toFixed(1) ?? "—"}%</strong><small className={passDelta >= 0 ? "delta-good" : "delta-bad"}>{passDelta >= 0 ? "+" : ""}{passDelta.toFixed(1)} points vs prior</small></article><article className="panel"><span>Latest mean score</span><strong>{latest?.meanScore.toFixed(2) ?? "—"}</strong><small>out of 5.0</small></article><article className="panel"><span>Historical runs</span><strong>{trend.length}</strong><small>{historyType === "e2e" && target === "all" ? `${stageTargets.length} targets per batch` : "matching this scope"}</small></article><article className="panel"><span>Gate record</span><strong>{trend.filter((point) => point.passRatePct >= 90).length}/{trend.length}</strong><small>runs at or above 90%</small></article></section>
    {trend.length ? <HistoryChart points={trend} title={historyType === "e2e" ? (target === "all" ? `${stage} · stage rollup` : target) : selectedSkill.label} windowDays={rangeDays} windowEnd={referenceTime}/> : <section className="panel empty"><strong>No historical runs in the selected {rangeDays}-day window</strong><span>Change the time window, environment or scope selection.</span></section>}
    {historyType === "e2e" ? <section className="target-history-grid">{latestByTarget.map((point) => <button key={point.target} className={`panel target-history-card ${target === point.target ? "selected" : ""}`} onClick={() => setTarget(point.target)}><div><span className="target-dot"/><strong>{point.target}</strong></div><b>{point.passRatePct.toFixed(1)}%</b><small>{e2eStageInRange.filter((item) => item.target === point.target).length} runs in {rangeDays}d · latest {formatDateShort(point.startedAt)}</small><i><em style={{width:`${point.passRatePct}%`}}/></i></button>)}</section> : <section className="panel unit-history-summary"><div><span className="collection-icon case">S</span><div><strong>{selectedSkill.label}</strong><small>{selectedSkill.id}</small></div></div><div><span>History source</span><strong>Live unit evaluation runs</strong></div><div><span>General quality</span><strong>{latestUnit?.generalQuality ? latestUnit.generalQuality.toFixed(2) : "case metric"}</strong></div><div><span>Tool use quality</span><strong>{latestUnit?.toolUseQuality ? latestUnit.toolUseQuality.toFixed(2) : "case metric"}</strong></div></section>}
    <section className="panel history-table"><div className="panel-heading"><div><h2>{isBatchRollup ? "Scheduled batch history" : "Matching run history"}</h2><p>{isBatchRollup ? "One rollup row per multi-target workflow execution · select a target above to open individual runs" : "Every execution for the selected scope · select a row to open its live run details"}</p></div><span className="result-count">{trend.length} results</span></div><div className="table-wrap"><table><thead><tr><th>{isBatchRollup ? "Batch" : "Run"}</th><th>Scope</th><th>Verdict</th><th>Pass rate</th><th>Mean score</th><th>Cases</th><th>Duration</th><th>Started</th></tr></thead><tbody>{[...trend].reverse().map((point) => <tr key={point.id} className={isBatchRollup ? undefined : "clickable-row"} tabIndex={isBatchRollup ? undefined : 0} aria-label={isBatchRollup ? undefined : `Open run ${point.id}`} onClick={isBatchRollup ? undefined : () => openHistoryRun(point.id)} onKeyDown={isBatchRollup ? undefined : (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openHistoryRun(point.id); } }}><td>{isBatchRollup ? <span className="run-link">{point.id}</span> : <button className="run-link" disabled={openingRunId === point.id} onClick={(event) => { event.stopPropagation(); openHistoryRun(point.id); }}>{openingRunId === point.id ? "Opening…" : point.id}</button>}{point.batchId && point.id !== point.batchId && <small>batch {point.batchId}</small>}</td><td>{point.scope}</td><td><StatusBadge verdict={point.verdict}/></td><td><strong>{point.passRatePct.toFixed(1)}%</strong></td><td>{point.meanScore.toFixed(2)}</td><td>{point.totalCases}</td><td>{formatDuration(point.durationMs)}</td><td>{formatTime(point.startedAt)}</td></tr>)}</tbody></table></div></section>
  </>;
}

function CompareView({ runs, api, onError }: { runs: EvalRun[]; api: EvalApi | null; onError: (message: string | null) => void }) {
  const [compareType, setCompareType] = useState<EvalType>("e2e");
  return <>
    <div className="page-heading compact"><div><span className="eyebrow">Regression analysis</span><h1>Compare evaluation runs</h1><p>Compare like with like: E2E targets and unit skill runs use separate baselines.</p></div><div className="type-switch"><button className={compareType === "e2e" ? "active" : ""} onClick={() => setCompareType("e2e")}>E2E targets</button><button className={compareType === "unit" ? "active" : ""} onClick={() => setCompareType("unit")}>Unit skills</button></div></div>
    <TypeComparison key={compareType} runs={runs} type={compareType} api={api} onError={onError} />
  </>;
}

function TypeComparison({ runs, type, api, onError }: { runs: EvalRun[]; type: EvalType; api: EvalApi | null; onError: (message: string | null) => void }) {
  return type === "unit" ? <UnitRunComparison runs={runs} api={api} onError={onError} /> : <E2ERunComparison runs={runs} api={api} onError={onError} />;
}

function E2ERunComparison({ runs, api, onError }: { runs: EvalRun[]; api: EvalApi | null; onError: (message: string | null) => void }) {
  const e2eRuns = runs.filter((run) => run.executionStatus === "completed" && run.evalType === "e2e").sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const scopes = Array.from(new Set(e2eRuns.map((run) => `${run.stage}::${run.target}`)));
  const [scope, setScope] = useState(scopes[0] ?? "");
  const comparable = e2eRuns.filter((run) => `${run.stage}::${run.target}` === scope);
  if (!e2eRuns.length) return <section className="panel empty"><strong>No completed E2E runs</strong><span>Load at least one completed target run before comparing.</span></section>;
  return <>
    <section className="panel compare-scope"><label><span>E2E target scope</span><select value={scope} onChange={(event) => setScope(event.target.value)}>{scopes.map((value) => { const [stage, target] = value.split("::"); return <option key={value} value={value}>{target} · {stage}</option>; })}</select></label><div><strong>Target-isolated comparison</strong><small>Only runs for this exact stage and target are available below.</small></div></section>
    <RunPairPicker key={scope} comparable={comparable} unitRuns={false} api={api} onError={onError} />
  </>;
}

function UnitRunComparison({ runs, api, onError }: { runs: EvalRun[]; api: EvalApi | null; onError: (message: string | null) => void }) {
  const unitRuns = runs.filter((run) => run.executionStatus === "completed" && run.evalType === "unit");
  const skills = Array.from(new Set(unitRuns.map((run) => run.unitConfig?.skillId).filter((value): value is string => Boolean(value))));
  const [skillId, setSkillId] = useState(skills[0] ?? "");
  const comparable = unitRuns.filter((run) => run.unitConfig?.skillId === skillId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <>
    <section className="panel compare-scope"><label><span>Unit skill</span><select value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((skill) => <option key={skill}>{skill}</option>)}</select></label><div><strong>Run comparison</strong><small>Defaults to the latest run versus the previous run, even when both use the same skill version.</small></div></section>
    {comparable.length ? <RunPairPicker key={skillId} comparable={comparable} unitRuns api={api} onError={onError} /> : <section className="panel empty"><strong>No completed runs</strong><span>{skillId || "This skill"} has no completed unit runs to compare.</span></section>}
  </>;
}

function RunPairPicker({ comparable, unitRuns, api, onError }: { comparable: EvalRun[]; unitRuns: boolean; api: EvalApi | null; onError: (message: string | null) => void }) {
  const defaultCandidate = comparable[0];
  const defaultBaseline = comparable[1] ?? comparable[0];
  const [baselineId, setBaselineId] = useState(defaultBaseline.runId);
  const [candidateId, setCandidateId] = useState(defaultCandidate.runId);
  const [caseSets, setCaseSets] = useState<Record<string, EvalCase[]>>({});
  const [loadingCases, setLoadingCases] = useState(true);
  const baseline = comparable.find((run) => run.runId === baselineId)!;
  const candidate = comparable.find((run) => run.runId === candidateId)!;
  const optionLabel = (run: EvalRun) => unitRuns
    ? `v${run.unitConfig?.skillVersion} · ${run.runId} · ${formatTime(run.startedAt)} · ${run.summary.passRatePct}%`
    : `${run.runId} · ${formatTime(run.startedAt)} · ${run.summary.passRatePct}%`;
  useEffect(() => {
    const controller = new AbortController();
    const selected = baseline.runId === candidate.runId ? [baseline] : [baseline, candidate];
    void Promise.all(selected.map(async (run) => {
      if (!api) throw new Error("Eval API is not configured. Comparison cases are unavailable.");
      const items = await api.listCases(run, controller.signal);
      return [run.runId, items.filter((item) => item.runId === run.runId)] as const;
    })).then((entries) => {
      if (!controller.signal.aborted) {
        setCaseSets((current) => ({ ...current, ...Object.fromEntries(entries) }));
        onError(null);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) onError(error instanceof Error ? error.message : "Unable to load comparison cases");
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingCases(false);
    });
    return () => controller.abort();
  }, [api, baseline, candidate, onError]);
  const baselineCases = caseSets[baseline.runId] ?? [];
  const candidateCases = caseSets[candidate.runId] ?? [];
  const hasUnitMetrics = !unitRuns || (
    baselineCases.some((item) => item.scores && Object.keys(item.scores).length) &&
    candidateCases.some((item) => item.scores && Object.keys(item.scores).length)
  );
  const baselineSuites = hasUnitMetrics ? summarizeCases(baseline, baselineCases) : baseline.suites;
  const candidateSuites = hasUnitMetrics ? summarizeCases(candidate, candidateCases) : candidate.suites;
  return <>
    <section className="panel compare-picker"><label><span>Baseline run</span><select value={baselineId} onChange={(event) => { setLoadingCases(true); onError(null); setBaselineId(event.target.value); }}>{comparable.map((run) => <option key={run.runId} value={run.runId}>{optionLabel(run)}</option>)}</select></label><span className="compare-arrow">→</span><label><span>Candidate run</span><select value={candidateId} onChange={(event) => { setLoadingCases(true); onError(null); setCandidateId(event.target.value); }}>{comparable.map((run) => <option key={run.runId} value={run.runId}>{optionLabel(run)}</option>)}</select></label></section>
    {loadingCases ? <section className="panel compare-loading"><span /><span /><span /> Loading case-level comparison…</section> : <ComparisonResults baseline={baseline} candidate={candidate} unitRuns={unitRuns} baselineSuites={baselineSuites} candidateSuites={candidateSuites} />}
  </>;
}

function ComparisonResults({ baseline, candidate, unitRuns, baselineSuites, candidateSuites }: { baseline: EvalRun; candidate: EvalRun; unitRuns: boolean; baselineSuites: SuiteSummary[]; candidateSuites: SuiteSummary[] }) {
  const passDelta = candidate.summary.passRatePct - baseline.summary.passRatePct;
  const scoreDelta = candidate.summary.meanScore - baseline.summary.meanScore;
  const durationDelta = (candidate.durationMs ?? 0) - (baseline.durationMs ?? 0);
  const suites = Array.from(new Set([...baselineSuites.map((suite) => suite.name), ...candidateSuites.map((suite) => suite.name)]));
  return <>
    <section className="delta-grid"><DeltaCard label="Pass rate" value={`${passDelta >= 0 ? "+" : ""}${passDelta.toFixed(1)}%`} good={passDelta >= 0} detail={`${baseline.summary.passRatePct}% → ${candidate.summary.passRatePct}%`} /><DeltaCard label="Mean score" value={`${scoreDelta >= 0 ? "+" : ""}${scoreDelta.toFixed(2)}`} good={scoreDelta >= 0} detail={`${baseline.summary.meanScore} → ${candidate.summary.meanScore}`} /><DeltaCard label="Duration" value={`${durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(durationDelta))}`} good={durationDelta <= 0} detail={`${formatDuration(baseline.durationMs)} → ${formatDuration(candidate.durationMs)}`} /><DeltaCard label="Failed cases" value={`${candidate.summary.failed - baseline.summary.failed >= 0 ? "+" : ""}${candidate.summary.failed - baseline.summary.failed}`} good={candidate.summary.failed <= baseline.summary.failed} detail={`${baseline.summary.failed} → ${candidate.summary.failed}`} /></section>
    <section className="panel compare-table"><div className="panel-heading"><div><h2>{unitRuns ? "Unit metric changes" : "Suite changes"}</h2><p>{unitRuns ? `v${baseline.unitConfig?.skillVersion} (${baseline.runId}) → v${candidate.unitConfig?.skillVersion} (${candidate.runId})` : "Case-derived mean score and result by suite"}</p></div></div><div className="table-wrap"><table><thead><tr><th>{unitRuns ? "Metric" : "Suite"}</th><th>Baseline score</th><th>Candidate score</th><th>Delta</th><th>Candidate result</th></tr></thead><tbody>{suites.map((name) => { const before=baselineSuites.find((suite)=>suite.name===name); const after=candidateSuites.find((suite)=>suite.name===name); const delta=(after?.meanScore??0)-(before?.meanScore??0); return <tr key={name}><td><strong>{name}</strong></td><td>{before?.total ? before.meanScore.toFixed(2) : "—"}</td><td>{after?.total ? after.meanScore.toFixed(2) : "—"}</td><td><span className={delta>=0?"delta-good":"delta-bad"}>{delta>=0?"+":""}{delta.toFixed(2)}</span></td><td>{after?.total ? `${after.passed}/${after.total} passed` : "Not run"}</td></tr>; })}{!suites.length && <tr><td colSpan={5}>No case metrics were returned for these runs.</td></tr>}</tbody></table></div></section>
  </>;
}

function DeltaCard({ label, value, good, detail }: { label: string; value: string; good: boolean; detail: string }) { return <article className="panel delta-card"><span>{label}</span><strong className={good ? "delta-good" : "delta-bad"}>{value}</strong><small>{detail}</small></article>; }

function SchemaView() {
  return <>
    <div className="page-heading compact"><div><span className="eyebrow">MongoDB collections</span><h1>Eval runs vs eval cases</h1><p>A run is the execution envelope; cases are the individual scored conversations or skill tests inside it.</p></div></div>
    <section className="relationship"><article className="collection-card"><header><span className="collection-icon">R</span><div><h2>unit_eval_runs · e2e_eval_runs</h2><p>One document per execution</p></div><b>1</b></header><ul><li>Type-specific configuration</li><li>Lifecycle, ownership and source version</li><li>Aggregate verdict and metrics</li><li>Small enough for fast list queries</li></ul></article><div className="relation-line"><strong>1 : N</strong><span>run_id</span></div><article className="collection-card"><header><span className="collection-icon case">C</span><div><h2>unit_eval_cases · e2e_eval_cases</h2><p>One document per evaluated case</p></div><b>N</b></header><ul><li>E2E: one live conversation scenario</li><li>Unit: one mocked skill test and its tool calls</li><li>Metric scores, thresholds and evidence</li><li>Filter and paginate independently</li></ul></article></section>
    <section className="launch-contracts"><article className="contract-card e2e"><TypeBadge type="e2e"/><h3>Target-first run</h3><p>Select a deployed target, then all or a subset of suites enabled by its target manifest.</p></article><article className="contract-card unit"><TypeBadge type="unit"/><h3>Exactly one skill per run</h3><p>A unit run evaluates one skill, its declared tools and one skill version. Compare latest vs previous by default.</p></article></section>
  </>;
}

function NewRunModal({ onClose, onCreate }: { onClose: () => void; onCreate: (run: EvalRun) => void }) {
  const [evalType, setEvalType] = useState<EvalType>("e2e");
  const [stage, setStage] = useState("1-dev-staging");
  const [target, setTarget] = useState("us-east4-dev-staging");
  const [selectedSuites, setSelectedSuites] = useState(e2eSuites.map((suite) => suite.id));
  const [maxTier, setMaxTier] = useState<"all" | 1 | 2 | 3>("all");
  const [selectedSkills, setSelectedSkills] = useState(["feedback-skill"]);
  const [bsaEnvironment, setBsaEnvironment] = useState("staging");
  const [mode, setMode] = useState<"all" | "single-turn" | "multi-turn">("all");
  const [tags, setTags] = useState("");
  const toggle = (value: string, current: string[], setCurrent: (values: string[]) => void) => setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const now = new Date();
    const common = { runId: `${evalType}-${now.getUTCSeconds().toString(16)}${now.getUTCMilliseconds().toString(16)}c9f2a1`, evalType, executionStatus: "queued" as const, verdict: "pending" as const, startedAt: now.toISOString(), trigger: "ui" as const, actor: "artem.kovtunenko", summary: { total: 0, passed: 0, failed: 0, passRatePct: 0, meanScore: 0, p95ResponseTimeMs: 0 } };
    if (evalType === "e2e") {
      onCreate({ ...common, evalType, stage, target, policyVersion: "gate-v4", datasetVersion: `e2e/${stage}/${target}/target.yaml`, e2eConfig: { kind: "live-target", targetId: target, selectedSuites, maxTier, passRateThreshold: 0.9 }, suites: selectedSuites.map((name) => ({ name, total: 0, passed: 0, failed: 0, meanScore: 0 })) });
    } else {
      const skillId = selectedSkills[0];
      onCreate({ ...common, evalType, stage: bsaEnvironment, target: skillId, policyVersion: "unit-v2", datasetVersion: `${skillId}@next`, unitConfig: { kind: "skill-eval", skillId, skillVersion: "next", bsaEnvironment, bsaVersion: "current", mode, metrics: ["tool_use_quality", "general_quality"] }, suites: [{ name: skillId, total: 0, passed: 0, failed: 0, meanScore: 0 }] });
    }
  };
  const canSubmit = evalType === "e2e" ? selectedSuites.length > 0 : selectedSkills.length > 0;
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Start a new evaluation run"><button className="modal-backdrop" onClick={onClose} aria-label="Close dialog"/><form className="new-run-modal" onSubmit={submit}><header><div><span className="eyebrow">Execution request</span><h2>Start evaluation run</h2><p>Choose the workflow first; E2E and unit runs intentionally use different inputs.</p></div><button type="button" onClick={onClose} aria-label="Close">×</button></header><div className="modal-body">
    <fieldset><legend>Evaluation workflow</legend><label className={evalType === "e2e" ? "selected" : ""}><input type="radio" name="type" value="e2e" checked={evalType === "e2e"} onChange={() => setEvalType("e2e")}/><span><strong>End-to-end</strong><small>Live conversations against one deployed target</small></span></label><label className={evalType === "unit" ? "selected" : ""}><input type="radio" name="type" value="unit" checked={evalType === "unit"} onChange={() => setEvalType("unit")}/><span><strong>Unit / skill</strong><small>One mock-backed skill evaluation per run</small></span></label></fieldset>
    {evalType === "e2e" ? <section className="workflow-form" aria-label="E2E run configuration"><div className="workflow-banner e2e"><span>◎</span><div><strong>Target-first live run</strong><p>The target manifest defines the deployed environment, credentials, roles and available suites. No tool mocking.</p></div></div><div className="form-grid"><label><span>Stage</span><select value={stage} onChange={(event) => { const value=event.target.value; setStage(value); setTarget(value === "1-dev-staging" ? "us-east4-dev-staging" : "us-east4-prod-staging"); }}><option>1-dev-staging</option><option>2-prod-staging</option></select></label><label><span>Deployed target</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{stage === "1-dev-staging" ? <option>us-east4-dev-staging</option> : <option>us-east4-prod-staging</option>}</select></label><label className="wide"><span>Conversation depth</span><select value={maxTier} onChange={(event) => setMaxTier(event.target.value === "all" ? "all" : Number(event.target.value) as 1 | 2 | 3)}><option value="all">All tiers enabled by target</option><option value="1">Tier 1 only</option><option value="2">Up to tier 2</option><option value="3">Up to tier 3</option></select></label></div><div className="selection-heading"><div><strong>Suites / skills to exercise</strong><small>Subset of suites already enabled for this target</small></div><button type="button" onClick={() => setSelectedSuites(selectedSuites.length === e2eSuites.length ? [] : e2eSuites.map((suite) => suite.id))}>{selectedSuites.length === e2eSuites.length ? "Clear all" : "Select all"}</button></div><div className="check-list">{e2eSuites.map((suite) => <label key={suite.id} className={selectedSuites.includes(suite.id) ? "checked" : ""}><input type="checkbox" checked={selectedSuites.includes(suite.id)} onChange={() => toggle(suite.id, selectedSuites, setSelectedSuites)}/><span><strong>{suite.label}</strong><small>{suite.note}</small></span></label>)}</div><div className="target-summary"><span>Target manifest</span><code>{`e2e/${stage}/${target}/target.yaml`}</code><span>Roles</span><strong>employee · manager</strong><span>Judge</span><strong>LLM-as-judge</strong></div></section> : <section className="workflow-form" aria-label="Unit skill run configuration"><div className="workflow-banner unit"><span>◇</span><div><strong>Skill-first mock-backed run</strong><p>Each skill brings its own evals.json, declared tools and REST or MCP mock setup.</p></div></div><div className="selection-heading"><div><strong>Skills to evaluate</strong><small>Select one skill or queue several independent skill evaluations</small></div><span>{selectedSkills.length} selected</span></div><div className="check-list skill-list">{unitSkills.map((skill) => <label key={skill.id} className={selectedSkills.includes(skill.id) ? "checked" : ""}><input type="checkbox" checked={selectedSkills.includes(skill.id)} onChange={() => toggle(skill.id, selectedSkills, setSelectedSkills)}/><span><strong>{skill.label}</strong><small>{skill.id}</small><em>{skill.tools.map((tool) => `◦ ${tool}`).join("  ")}</em></span></label>)}</div><div className="form-grid unit-options"><label><span>BSA environment</span><select value={bsaEnvironment} onChange={(event) => setBsaEnvironment(event.target.value)}><option value="staging">Staging BSA</option><option value="dev">Development BSA</option><option value="local">Local BSA</option></select></label><label><span>Conversation mode</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">All test modes</option><option value="single-turn">Single-turn only</option><option value="multi-turn">Multi-turn only</option></select></label><label className="wide"><span>Optional tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="smoke, tool-calling" /></label></div><div className="scoring-preview"><div><span>Deterministic</span><strong>tool_use_quality</strong><small>Expected tool calls and parameter matching</small></div><div><span>LLM judge</span><strong>general_quality</strong><small>Response measured against the case reference</small></div><p><strong>Gate:</strong> every computed metric must clear its threshold; overall run pass rate must be at least 90%.</p></div></section>}
    <div className="queue-note"><span>↗</span><div><strong>Asynchronous execution</strong><p>The API validates this type-specific payload, returns a run ID and publishes work to the Python evaluator.</p></div></div></div><footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={!canSubmit}>Queue {evalType === "e2e" ? "live E2E" : `${selectedSkills.length} skill`} evaluation{evalType === "unit" && selectedSkills.length !== 1 ? "s" : ""}</button></footer></form></div>;
}

void NewRunModal;
