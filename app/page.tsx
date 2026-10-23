"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarFooter } from "./components/sidebar-footer";
import {
  evaluationNavItems,
  SidebarNavigation,
  type EvaluationView,
} from "./components/sidebar-navigation";
import { configuredEvalApi, type EvalApi } from "./lib/eval-api";
import type {
  EvalCase,
  EvalRun,
  EvalTurn,
  EvalType,
  ExecutionStatus,
  SuiteSummary,
  Verdict,
} from "./lib/eval-types";

type View = EvaluationView;

type DrilldownTrendKind = "skill" | "case" | "metric";

type DrilldownTrendRequest = {
  kind: DrilldownTrendKind;
  evalType: EvalType;
  skill: string;
  caseId?: string;
  metric?: string;
  stage: string;
  target: string;
  environment: string;
  targetEnvironment?: string;
  category?: string;
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
  githubRunId?: string;
  githubRunUrl?: string;
  gitSha?: string;
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

const unitSkills = [
  { id: "feedback-skill", label: "Feedback", tools: ["submit_feedback"] },
  {
    id: "time-off-balance-skill",
    label: "Time-off balance",
    tools: ["get_time_off_balance"],
  },
  {
    id: "create-requisition-skill",
    label: "Create requisition",
    tools: ["create_requisition", "get_requisition"],
  },
  {
    id: "verify-license-skill",
    label: "Verify license",
    tools: ["verify_license"],
  },
];

const e2eSuites = [
  {
    id: "navigation",
    label: "Navigation",
    note: "Live product navigation conversations",
  },
  {
    id: "feedback",
    label: "Feedback",
    note: "Live feedback submission conversations",
  },
  {
    id: "general_inquiry",
    label: "General inquiry",
    note: "Cross-skill live assistant behavior",
  },
];

function StatusBadge({ verdict }: { verdict: Verdict }) {
  const label = verdict === "xpassed" ? "XPASS" : verdict;
  const title =
    verdict === "xpassed"
      ? "Unexpected pass: this known-bug/expected-failure case passed and should be reviewed."
      : verdict === "blocked"
        ? "Blocked: the evaluation could not complete, usually because setup, schema validation, a dependency, or execution failed."
        : undefined;
  return (
    <span
      className={`status status--${verdict}`}
      title={title}
      aria-label={title ? `${label}: ${title}` : label}
    >
      <i />
      {label}
    </span>
  );
}

function MetricGateTags({
  scores,
  thresholds,
  column,
}: {
  scores: Record<string, number>;
  thresholds?: Record<string, number>;
  column: "score" | "threshold";
}) {
  const entries = Object.entries(scores);
  if (!entries.length) {
    return <span className="metric-gate-empty">No metrics recorded</span>;
  }
  return (
    <div className={`metric-gate-tags metric-gate-tags--${column}`}>
      {entries.map(([metric, score]) => {
        const threshold = thresholds?.[metric];
        const hasThreshold = typeof threshold === "number";
        const passed = hasThreshold ? score >= threshold : undefined;
        const state =
          passed === undefined ? "unknown" : passed ? "pass" : "fail";
        const readableMetric = metric.replaceAll("_", " ");
        const detail = hasThreshold
          ? `${readableMetric}: ${score.toFixed(1)} ${passed ? "meets" : "is below"} the ${threshold.toFixed(1)} threshold`
          : `${readableMetric}: threshold not recorded`;

        return (
          <span
            className={`metric-gate-tag metric-gate-tag--${state}`}
            title={detail}
            key={metric}
          >
            {column === "score" ? (
              <>
                <b aria-hidden="true">
                  {passed === undefined ? "?" : passed ? "✓" : "×"}
                </b>
                <span>{readableMetric}</span>
                <strong>{score.toFixed(1)}</strong>
              </>
            ) : hasThreshold ? (
              <>
                <span>requires</span>
                <strong>≥ {threshold.toFixed(1)}</strong>
              </>
            ) : (
              <span>not recorded</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function effectiveRunVerdict(run: EvalRun): Verdict {
  return run.executionStatus === "error" ? "blocked" : run.verdict;
}

function isBlockedRun(run: EvalRun) {
  return run.verdict === "blocked" || run.executionStatus === "blocked";
}

function runGateThresholdPct(run: EvalRun) {
  const threshold = run.e2eConfig?.passRateThreshold;
  if (threshold === undefined || threshold === null) return undefined;
  return threshold <= 1 ? threshold * 100 : threshold;
}

function isDegradedRun(run: EvalRun) {
  const threshold = runGateThresholdPct(run);
  return (
    run.executionStatus === "completed" &&
    threshold !== undefined &&
    run.summary.passRatePct < threshold
  );
}

function isNeedsAttentionRun(run: EvalRun) {
  return (
    !isBlockedRun(run) &&
    (run.executionStatus === "error" ||
      run.verdict === "failed" ||
      run.verdict === "xpassed" ||
      isDegradedRun(run))
  );
}

function attentionSignal(run: EvalRun) {
  if (run.executionStatus === "error") return "Error";
  if (run.verdict === "xpassed") return "XPASS";
  if (isDegradedRun(run)) {
    const threshold = runGateThresholdPct(run);
    return `${run.summary.passRatePct}% < ${threshold}%`;
  }
  return `${run.summary.passRatePct}%`;
}

function shortGitSha(sha?: string) {
  return sha ? sha.slice(0, 7) : "not recorded";
}

function isTerminalHistoryRun(run: EvalRun) {
  return (
    run.executionStatus === "completed" ||
    run.executionStatus === "blocked" ||
    run.executionStatus === "error"
  );
}

function TypeBadge({ type }: { type: EvalType }) {
  return (
    <span className={`type-badge type-badge--${type}`}>
      {type.toUpperCase()}
    </span>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hour = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"} UTC`;
}

function formatDateShort(iso: string) {
  const date = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number") return "—";
  const seconds = Math.round(ms / 1000);
  return seconds > 90
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

function formatPassRateThreshold(value?: number) {
  if (value === undefined || value === null) return "Not recorded";
  const percentage = value <= 1 ? value * 100 : value;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

function formatEvaluationLayer(value?: string) {
  if (!value?.trim()) return undefined;
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function runScope(run: EvalRun) {
  if (run.evalType === "e2e") {
    return {
      primary: run.target,
      secondary: `${run.stage} · live conversation`,
    };
  }
  const skill = run.unitConfig?.skillId ?? run.target;
  const skillVersion = run.unitConfig?.skillVersion;
  const evaluationLayer = formatEvaluationLayer(
    run.unitConfig?.evaluationLayer,
  );
  return {
    primary: skill,
    secondary: [
      run.unitConfig?.category,
      run.unitConfig?.targetEnvironment,
      run.unitConfig?.bsaEnvironment ?? run.stage,
      evaluationLayer,
      skillVersion && skillVersion.toLowerCase() !== "unknown"
        ? `skill v${skillVersion}`
        : undefined,
      "mock-backed",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function MetricCard({
  label,
  value,
  note,
  tone,
  spark,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  spark: number[];
}) {
  const values = spark.length ? spark : [0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values
    .map(
      (value, index) =>
        `${values.length === 1 ? 45 : index * (90 / (values.length - 1))},${31 - ((value - min) / range) * 22}`,
    )
    .join(" ");
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon--${tone}`}>
        {tone === "red"
          ? "!"
          : tone === "blue"
            ? "↗"
            : tone === "violet"
              ? "◷"
              : "✓"}
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      <svg
        className={`spark spark--${tone}`}
        viewBox="0 0 90 38"
        aria-hidden="true"
      >
        <polyline points={points} />
      </svg>
    </article>
  );
}

type DailyTrend = { date: string; e2e?: number; unit?: number };

function TrendChart({
  points,
  type,
  showPercentLabels,
}: {
  points: DailyTrend[];
  type: "all" | EvalType;
  showPercentLabels: boolean;
}) {
  const width = 660;
  const top = 18;
  const bottom = 180;
  const x = (index: number) =>
    points.length < 2 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (value: number) => top + ((100 - value) / 100) * (bottom - top);
  const line = (evalType: EvalType) =>
    points
      .flatMap((point, index) => {
        const value = point[evalType];
        return typeof value === "number" ? [`${x(index)},${y(value)}`] : [];
      })
      .join(" ");
  const labelCount = Math.min(7, points.length);
  const labelIndexes = Array.from({ length: labelCount }, (_, index) =>
    Math.round((index * (points.length - 1)) / Math.max(labelCount - 1, 1)),
  );
  const visibleTypes: EvalType[] = type === "all" ? ["e2e", "unit"] : [type];
  const hasData = visibleTypes.some((evalType) =>
    points.some((point) => typeof point[evalType] === "number"),
  );
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label="Pass rate trend for E2E and unit evaluations"
    >
      <div className="chart-axis">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
      </div>
      <svg viewBox="0 0 660 210" preserveAspectRatio="none" aria-hidden="true">
        <g className="grid-lines">
          <line x1="0" x2="660" y1="18" y2="18" />
          <line x1="0" x2="660" y1="72" y2="72" />
          <line x1="0" x2="660" y1="126" y2="126" />
          <line x1="0" x2="660" y1="180" y2="180" />
        </g>
        {visibleTypes.map((evalType) => (
          <polyline
            key={evalType}
            className={`line line--${evalType}`}
            points={line(evalType)}
          />
        ))}
        {visibleTypes.flatMap((evalType) =>
          points.map((point, index) =>
            typeof point[evalType] === "number" ? (
              <circle
                key={`${evalType}-${point.date}`}
                className={`trend-dot trend-dot--${evalType}`}
                cx={x(index)}
                cy={y(point[evalType]!)}
                r="3"
              >
                <title>{`${evalType.toUpperCase()} ${point.date}: ${point[evalType]!.toFixed(1)}%`}</title>
              </circle>
            ) : null,
          ),
        )}
        {showPercentLabels &&
          visibleTypes.flatMap((evalType) =>
            points.map((point, index) =>
              typeof point[evalType] === "number" ? (
                <text
                  key={`label-${evalType}-${point.date}`}
                  className={`trend-value trend-value--${evalType}`}
                  x={x(index)}
                  y={Math.max(
                    11,
                    y(point[evalType]!) + (evalType === "e2e" ? -8 : 13),
                  )}
                  textAnchor="middle"
                >
                  {point[evalType]!.toFixed(point[evalType]! % 1 ? 1 : 0)}%
                </text>
              ) : null,
            ),
          )}
      </svg>
      {!hasData && (
        <div className="chart-empty">No completed runs in this window</div>
      )}
      <div className="chart-days">
        {labelIndexes.map((index) => (
          <span key={`${points[index]?.date}-${index}`}>
            {points[index]
              ? formatDateShort(`${points[index].date}T00:00:00.000Z`)
              : ""}
          </span>
        ))}
      </div>
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
  if (
    run.evalType === "unit" &&
    cases.some((item) => item.scores && Object.keys(item.scores).length)
  ) {
    const metrics = new Map<
      string,
      Array<{ score: number; verdict: EvalCase["verdict"] }>
    >();
    cases.forEach((item) =>
      Object.entries(item.scores ?? {}).forEach(([name, score]) =>
        metrics.set(name, [
          ...(metrics.get(name) ?? []),
          { score, verdict: item.verdict },
        ]),
      ),
    );
    return Array.from(metrics.entries()).map(([name, results]) => ({
      name,
      total: results.length,
      passed: results.filter(
        (result) => result.verdict === "passed" || result.verdict === "xpassed",
      ).length,
      failed: results.filter(
        (result) => result.verdict !== "passed" && result.verdict !== "xpassed",
      ).length,
      meanScore:
        results.reduce((sum, result) => sum + result.score, 0) / results.length,
    }));
  }
  const groups = new Map<string, EvalCase[]>();
  cases.forEach((item) =>
    groups.set(item.suite, [...(groups.get(item.suite) ?? []), item]),
  );
  return Array.from(groups.entries()).map(([name, grouped]) => ({
    name,
    total: grouped.length,
    passed: grouped.filter(
      (item) => item.verdict === "passed" || item.verdict === "xpassed",
    ).length,
    failed: grouped.filter(
      (item) => item.verdict !== "passed" && item.verdict !== "xpassed",
    ).length,
    meanScore:
      grouped.reduce((sum, item) => sum + item.score, 0) / grouped.length,
  }));
}

function drilldownRequest(
  run: EvalRun,
  kind: DrilldownTrendKind,
  skill: string,
  caseId?: string,
  metric?: string,
): DrilldownTrendRequest {
  return {
    kind,
    evalType: run.evalType,
    skill,
    caseId,
    metric,
    stage: run.stage,
    target: run.target,
    environment: run.unitConfig?.bsaEnvironment ?? run.stage,
    targetEnvironment: run.unitConfig?.targetEnvironment,
    category: run.unitConfig?.category,
    sourceRunId: run.runId,
  };
}

function RunsTable({
  runs,
  onOpen,
}: {
  runs: EvalRun[];
  onOpen: (run: EvalRun) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Type</th>
            <th>Evaluation scope</th>
            <th>Verdict</th>
            <th>Pass rate</th>
            <th>Mean score</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.runId}
              tabIndex={0}
              onClick={() => onOpen(run)}
              onKeyDown={(event) => event.key === "Enter" && onOpen(run)}
            >
              <td>
                <button
                  className="run-link"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(run);
                  }}
                >
                  {run.runId}
                </button>
                <small>
                  {run.actor} · {run.trigger}
                </small>
              </td>
              <td>
                <TypeBadge type={run.evalType} />
              </td>
              <td>
                <span>{runScope(run).primary}</span>
                <small>{runScope(run).secondary}</small>
              </td>
              <td>
                <StatusBadge verdict={effectiveRunVerdict(run)} />
              </td>
              <td>
                <div className="rate">
                  <span>
                    {run.summary.passRatePct || "—"}
                    {run.summary.passRatePct ? "%" : ""}
                  </span>
                  <i>
                    <b style={{ width: `${run.summary.passRatePct}%` }} />
                  </i>
                </div>
              </td>
              <td>
                <strong className="score">
                  {run.summary.meanScoreRecorded
                    ? run.summary.meanScore.toFixed(2)
                    : "Not recorded"}
                </strong>
                <small>
                  {run.summary.total
                    ? `/ 5.0 · ${run.summary.total} cases`
                    : "Waiting"}
                </small>
              </td>
              <td>{formatDuration(run.durationMs)}</td>
              <td>{formatTime(run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && (
        <div className="empty">
          <strong>No runs found</strong>
          <span>Try changing your filters or search term.</span>
        </div>
      )}
    </div>
  );
}

type RunGroupingLens =
  | "adaptive"
  | "skill"
  | "target"
  | "attention"
  | "table";

type ResolvedRunGrouping = "skill" | "target" | "attention";
type RunSortOrder =
  | "newest"
  | "oldest"
  | "pass-high"
  | "pass-low"
  | "score-high"
  | "score-low";

function runSkillLabel(run: EvalRun) {
  return run.unitConfig?.skillId ?? run.target ?? "Scope not recorded";
}

function recordedRunTarget(run: EvalRun): string | null {
  // Unit run.target is the skill identifier, not a target environment. Older
  // unit records may not have target_environment, so never use run.target as
  // their fallback or the UI will incorrectly create skill-named targets.
  if (run.evalType === "unit") {
    return run.unitConfig?.targetEnvironment?.trim() || null;
  }
  return run.target?.trim() || run.stage?.trim() || null;
}

function runTargetLabel(run: EvalRun) {
  return recordedRunTarget(run) ?? "Target not recorded";
}

function runRequiresAttention(run: EvalRun) {
  const outcome = effectiveRunVerdict(run);
  return !["passed", "xpassed"].includes(outcome);
}

function metricLabel(metric: string) {
  return metric
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function runMetricSummary(
  run: EvalRun,
  runCases: EvalCase[] | undefined,
  metric: string,
) {
  const scores = (runCases ?? []).flatMap((item) => {
    const score = item.scores?.[metric];
    return typeof score === "number" && Number.isFinite(score) ? [score] : [];
  });
  const thresholds = (runCases ?? []).flatMap((item) => {
    const threshold = item.thresholds?.[metric];
    return typeof threshold === "number" && Number.isFinite(threshold)
      ? [threshold]
      : [];
  });
  const fallback = run.summary.metricMeans?.[metric];
  const score =
    fallback ??
    (scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : undefined);
  const threshold = thresholds.length
    ? thresholds.reduce((sum, value) => sum + value, 0) / thresholds.length
    : undefined;
  return { score, threshold };
}

function MetricMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (metrics: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toggleMetric = (metric: string) =>
    onChange(
      selected.includes(metric)
        ? selected.filter((item) => item !== metric)
        : [...selected, metric],
    );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <section className="run-visible-metrics" aria-label="Visible metrics">
      <strong>Visible metrics</strong>
      <div className="run-visible-metric-controls">
        {selected.map((metric) => (
          <button
            type="button"
            className="run-visible-metric-chip"
            key={metric}
            onClick={() => toggleMetric(metric)}
            title={`Remove ${metricLabel(metric)}`}
          >
            <span aria-hidden="true">✓</span>
            {metricLabel(metric)}
          </button>
        ))}
        <div
          className={`metric-multiselect${open ? " open" : ""}`}
          ref={pickerRef}
        >
          <button
            type="button"
            className="metric-multiselect-trigger"
            aria-label="Add visible metrics"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            ref={triggerRef}
          >
            <span aria-hidden="true">＋</span>
            Add metric
          </button>
          {open && (
            <div
              className="metric-multiselect-menu"
              role="dialog"
              aria-label="Choose visible metrics"
            >
              <div className="metric-multiselect-heading">
                <strong>Available metrics</strong>
                <span>{options.length} recorded in this scope</span>
              </div>
              <div className="metric-multiselect-actions">
                <button type="button" onClick={() => onChange(options)}>
                  Select all
                </button>
                <button type="button" onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
              {options.map((metric) => (
                <label key={metric}>
                  <input
                    type="checkbox"
                    checked={selected.includes(metric)}
                    onChange={() => toggleMetric(metric)}
                  />
                  <span>{metricLabel(metric)}</span>
                </label>
              ))}
              {options.length === 0 && (
                <p>No case metrics were returned for this scope.</p>
              )}
              <div className="metric-multiselect-footer">
                <span>{selected.length} selected</span>
                <button type="button" onClick={() => setOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        {selected.length === 0 && (
          <span className="run-visible-metrics-hint">
            Add metrics to enable row-level metric history.
          </span>
        )}
      </div>
    </section>
  );
}

function RunGroups({
  runs,
  lens,
  category,
  skill,
  targetEnvironment,
  sortOrder,
  api,
  selectedMetrics,
  onOpen,
}: {
  runs: EvalRun[];
  lens: RunGroupingLens;
  category: string;
  skill: string;
  targetEnvironment: string;
  sortOrder: RunSortOrder;
  api: EvalApi | null;
  selectedMetrics: string[];
  onOpen: (run: EvalRun) => void;
}) {
  const [expandedMetrics, setExpandedMetrics] = useState<Set<string>>(
    () => new Set(),
  );
  const [metricCasesByRun, setMetricCasesByRun] = useState<
    Record<string, EvalCase[]>
  >({});
  const [loadingMetricRows, setLoadingMetricRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [metricRowErrors, setMetricRowErrors] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleMetricRow = async (rowKey: string, rowRuns: EvalRun[]) => {
    if (!selectedMetrics.length) return;
    if (expandedMetrics.has(rowKey)) {
      setExpandedMetrics((current) => {
        const next = new Set(current);
        next.delete(rowKey);
        return next;
      });
      return;
    }
    setExpandedMetrics((current) => new Set(current).add(rowKey));
    if (!api) return;
    const runsToLoad = rowRuns
      .slice(0, 6)
      .filter(
        (run) => run.evalType === "unit" && !metricCasesByRun[run.runId],
      );
    if (!runsToLoad.length) return;
    setLoadingMetricRows((current) => new Set(current).add(rowKey));
    setMetricRowErrors((current) => {
      const next = new Set(current);
      next.delete(rowKey);
      return next;
    });
    try {
      const results = await Promise.allSettled(
        runsToLoad.map(async (run) => [run.runId, await api.listCases(run)] as const),
      );
      const loaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setMetricCasesByRun((current) => ({
        ...current,
        ...Object.fromEntries(loaded),
      }));
      if (results.some((result) => result.status === "rejected")) {
        setMetricRowErrors((current) => new Set(current).add(rowKey));
      }
    } finally {
      setLoadingMetricRows((current) => {
        const next = new Set(current);
        next.delete(rowKey);
        return next;
      });
    }
  };
  const resolvedLens: ResolvedRunGrouping =
    lens !== "adaptive" && lens !== "table"
      ? lens
      : skill !== "all"
        ? "target"
        : targetEnvironment !== "all" || category !== "all"
          ? "skill"
          : "attention";
  const groupingExplanation =
    lens === "adaptive"
      ? skill !== "all"
        ? "A skill is selected, so targets become the primary comparison."
        : targetEnvironment !== "all"
          ? "A target is selected, so skills become the primary comparison."
          : category !== "all"
            ? "A category is selected, so skills are grouped before targets."
            : "The broad scope is organized by attention level first."
      : resolvedLens === "skill"
        ? "Skills are grouped first, with target environments nested inside."
        : resolvedLens === "target"
          ? "Target environments are grouped first, with skills nested inside."
          : "Failures, blocked runs, and missing quality data rise to the top.";
  const primaryLabel =
    resolvedLens === "skill"
      ? "skill"
      : resolvedLens === "target"
        ? "target"
        : "attention";
  const groupKey = (run: EvalRun) => {
    if (resolvedLens === "skill") return runSkillLabel(run);
    if (resolvedLens === "target") return runTargetLabel(run);
    if (runRequiresAttention(run)) return "Needs attention";
    if (run.evalType === "unit" && !run.summary.meanScoreRecorded)
      return "Missing quality data";
    return "Healthy";
  };
  const secondaryKey = (run: EvalRun) =>
    resolvedLens === "skill"
      ? runTargetLabel(run)
      : resolvedLens === "target"
        ? runSkillLabel(run)
        : `${runSkillLabel(run)} · ${runTargetLabel(run)}`;
  const groupOrder = ["Needs attention", "Missing quality data", "Healthy"];
  const groupedRuns = Array.from(
    runs.reduce((groups, run) => {
      const key = groupKey(run);
      groups.set(key, [...(groups.get(key) ?? []), run]);
      return groups;
    }, new Map<string, EvalRun[]>()),
  ).sort(([left], [right]) => {
    if (resolvedLens !== "attention") return left.localeCompare(right);
    return groupOrder.indexOf(left) - groupOrder.indexOf(right);
  });
  const totalCases = runs.reduce((total, run) => total + run.summary.total, 0);
  const passedCases = runs.reduce(
    (total, run) => total + run.summary.passed,
    0,
  );
  const observedPassRate = totalCases ? (passedCases / totalCases) * 100 : 0;
  const attentionCount = runs.filter(runRequiresAttention).length;
  const recordedCoverage = new Set(
    runs.flatMap((run) => {
      const target = recordedRunTarget(run);
      return target ? [`${runSkillLabel(run)}::${target}`] : [];
    }),
  );
  const missingTargetCount = runs.filter(
    (run) => recordedRunTarget(run) === null,
  ).length;

  return (
    <div className="run-groups-view">
      <div className="run-grouping-context">
        <div>
          <span>Current organization</span>
          <strong>
            {resolvedLens === "attention"
              ? "Attention first"
              : `${resolvedLens} → ${resolvedLens === "skill" ? "target" : "skill"}`}
          </strong>
        </div>
        <p>{groupingExplanation}</p>
      </div>
      <section className="run-group-metrics" aria-label="Grouped run summary">
        <article className={attentionCount ? "needs-attention" : undefined}>
          <span>Needs attention</span>
          <strong>{attentionCount}</strong>
          <small>failed, blocked, or incomplete runs</small>
        </article>
        <article>
          <span>Observed pass rate</span>
          <strong>{observedPassRate.toFixed(1)}%</strong>
          <small>case-weighted in this scope</small>
        </article>
        <article>
          <span>Coverage</span>
          <strong>{recordedCoverage.size}</strong>
          <small>
            recorded skill × target combinations
            {missingTargetCount > 0
              ? ` · ${missingTargetCount} missing target`
              : ""}
          </small>
        </article>
        <article>
          <span>Matching runs</span>
          <strong>{runs.length}</strong>
          <small>{groupedRuns.length} {primaryLabel} groups</small>
        </article>
      </section>
      <div className="run-group-list">
        {groupedRuns.map(([groupName, groupRuns], groupIndex) => {
          const groupCases = groupRuns.reduce(
            (total, run) => total + run.summary.total,
            0,
          );
          const groupPassed = groupRuns.reduce(
            (total, run) => total + run.summary.passed,
            0,
          );
          const groupPassRate = groupCases
            ? (groupPassed / groupCases) * 100
            : 0;
          const scoredRuns = groupRuns.filter(
            (run) => run.summary.meanScoreRecorded,
          );
          const groupMean = scoredRuns.length
            ? scoredRuns.reduce(
                (total, run) => total + run.summary.meanScore,
                0,
              ) / scoredRuns.length
            : null;
          const groupAttention = groupRuns.filter(runRequiresAttention).length;
          const latestRun = [...groupRuns].sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt),
          )[0];
          const subgroups = Array.from(
            groupRuns.reduce((items, run) => {
              const key = secondaryKey(run);
              items.set(key, [...(items.get(key) ?? []), run]);
              return items;
            }, new Map<string, EvalRun[]>()),
          ).sort(([left], [right]) => left.localeCompare(right));
          const recordedTargetCount = new Set(
            groupRuns.flatMap((run) => {
              const target = recordedRunTarget(run);
              return target ? [target] : [];
            }),
          ).size;
          const groupMissingTargetCount = groupRuns.filter(
            (run) => recordedRunTarget(run) === null,
          ).length;
          const subgroupCount =
            resolvedLens === "skill" ? recordedTargetCount : subgroups.length;
          const subgroupLabel = resolvedLens === "skill" ? "target" : "skill";
          const groupState = groupAttention
            ? "attention"
            : groupName === "Missing quality data"
              ? "missing"
              : "healthy";
          return (
            <details
              className={`run-group run-group--${groupState}`}
              key={groupName}
              open={groupIndex === 0}
            >
              <summary>
                <span className="run-group-marker" />
                <span className="run-group-name">
                  <strong>{groupName}</strong>
                  <small>
                    {subgroupCount} {subgroupLabel}
                    {subgroupCount === 1 ? "" : "s"} · {groupRuns.length} runs
                    {groupMissingTargetCount > 0
                      ? ` · ${groupMissingTargetCount} target not recorded`
                      : ""} · latest {formatTime(latestRun.startedAt)}
                  </small>
                </span>
                <span className="run-group-stat">
                  <small>Pass rate</small>
                  <strong>{groupPassRate.toFixed(1)}%</strong>
                </span>
                <span className="run-group-stat">
                  <small>Mean score</small>
                  <strong>{groupMean === null ? "—" : groupMean.toFixed(2)}</strong>
                </span>
                <span className="run-group-stat">
                  <small>Attention</small>
                  <strong>{groupAttention}</strong>
                </span>
                <span className="run-group-chevron">›</span>
              </summary>
              <div className="run-subgroup-list">
                {subgroups.map(([subgroupName, subgroupRuns]) => {
                  const latest = [...subgroupRuns].sort((left, right) =>
                    right.startedAt.localeCompare(left.startedAt),
                  )[0];
                  const rowKey = `${groupName}::${subgroupName}`;
                  const metricsOpen = expandedMetrics.has(rowKey);
                  // filteredRuns already carries the selected sort order. The
                  // grouping reductions preserve it, so do not replace it with
                  // a chronological timeline here.
                  const displayedRuns = subgroupRuns.slice(0, 6);
                  // The metric matrix must use the exact same run selection and
                  // order as the markers above it. Sorting again here makes the
                  // two views disagree and ignores "Sort within groups".
                  const matrixRuns = displayedRuns;
                  // Keep every expanded matrix on the same six-run track as
                  // the compact marker row. With fewer runs, the populated
                  // columns stay left-aligned instead of stretching across
                  // the available width.
                  const matrixGridColumns =
                    "minmax(170px, 1.25fr) repeat(6, minmax(86px, 1fr))";
                  return (
                    <div
                      className={`run-subgroup-block${metricsOpen ? " run-subgroup-block--metrics-open" : ""}`}
                      key={subgroupName}
                    >
                      <div className="run-subgroup">
                        <span className="run-subgroup-name">
                          <strong>{subgroupName}</strong>
                          <small>
                            {subgroupRuns.length > 6
                              ? `Latest 6 of ${subgroupRuns.length} runs`
                              : `${subgroupRuns.length} run${subgroupRuns.length === 1 ? "" : "s"}`}
                          </small>
                        </span>
                        <span
                          className="run-sequence"
                          aria-label={`Runs for ${subgroupName}, sorted ${sortOrder}`}
                        >
                          {displayedRuns.map((run) => (
                            <button
                              type="button"
                              key={run.runId}
                              className={`run-sequence-mark run-sequence-mark--${effectiveRunVerdict(run)}`}
                              aria-label={`Open ${run.runId}, ${effectiveRunVerdict(run)}, ${run.summary.passRatePct.toFixed(1)} percent`}
                              title={`${run.runId} · ${run.summary.passRatePct.toFixed(1)}%`}
                              onClick={() => onOpen(run)}
                            />
                          ))}
                        </span>
                        <span className="run-subgroup-score">
                          <small>Latest</small>
                          <strong>{metricLabel(effectiveRunVerdict(latest))}</strong>
                        </span>
                        <span className="run-subgroup-actions">
                          <button
                            type="button"
                            className="run-metrics-trigger"
                            disabled={!selectedMetrics.length}
                            aria-expanded={metricsOpen}
                            onClick={() => void toggleMetricRow(rowKey, displayedRuns)}
                            title={
                              selectedMetrics.length
                                ? "Show selected metrics for the latest six runs"
                                : "Choose metrics above to enable this view"
                            }
                          >
                            <span aria-hidden="true">▦</span>
                            <span
                              className={`run-metrics-chevron${metricsOpen ? " open" : ""}`}
                              aria-hidden="true"
                            >
                              ›
                            </span>
                          </button>
                        </span>
                      </div>
                      {metricsOpen && (
                        <div
                          className="run-metric-matrix"
                          aria-label={`Selected metrics for ${subgroupName}`}
                          style={{
                            gridTemplateColumns: matrixGridColumns,
                          }}
                        >
                          <div className="run-metric-matrix-corner">
                            <strong>Metric / threshold</strong>
                          </div>
                          {matrixRuns.map((run) => (
                            <button
                              type="button"
                              className="run-metric-column-heading"
                              key={run.runId}
                              onClick={() => onOpen(run)}
                              title={`Open ${run.runId}`}
                            >
                              <strong>{new Date(run.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong>
                            </button>
                          ))}
                          {selectedMetrics.map((metric) => {
                            const metricSummaries = matrixRuns.map((run) =>
                              runMetricSummary(run, metricCasesByRun[run.runId], metric),
                            );
                            const threshold = [...metricSummaries]
                              .reverse()
                              .find((summary) => summary.threshold !== undefined)?.threshold;
                            return (
                              <div
                                className="run-metric-row"
                                key={metric}
                                style={{
                                  gridTemplateColumns: matrixGridColumns,
                                }}
                              >
                                <span className="run-metric-name" title={metric}>
                                  <strong>{metricLabel(metric)}</strong>
                                  {threshold !== undefined && (
                                    <small>≥ {threshold.toFixed(1)}</small>
                                  )}
                                </span>
                                {matrixRuns.map((run) => {
                                  const summary = runMetricSummary(
                                    run,
                                    metricCasesByRun[run.runId],
                                    metric,
                                  );
                                  const state =
                                    summary.score === undefined
                                      ? "missing"
                                      : summary.threshold === undefined
                                        ? "neutral"
                                        : summary.score >= summary.threshold
                                          ? "passed"
                                          : "failed";
                                  return (
                                    <button
                                      type="button"
                                      className={`run-metric-cell run-metric-cell--${state}${run.runId === latest.runId ? " run-metric-cell--latest" : ""}`}
                                      key={run.runId}
                                      onClick={() => onOpen(run)}
                                      title={`${metricLabel(metric)} · ${run.runId}`}
                                    >
                                      {summary.score === undefined
                                        ? "—"
                                        : summary.score.toFixed(2)}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                          {loadingMetricRows.has(rowKey) && (
                            <p className="run-metric-status">Loading case metrics…</p>
                          )}
                          {metricRowErrors.has(rowKey) && (
                            <p className="run-metric-status run-metric-status--error">
                              Some case metrics could not be loaded. Run-summary values are shown where available.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
        {groupedRuns.length === 0 && (
          <div className="empty">
            <strong>No runs found</strong>
            <span>Try changing your filters or search term.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const RUNS_PAGE_SIZE = 25;
  // Resolve the public API URL after hydration. Reading a build-time public
  // environment variable during the first render can produce different server
  // and browser trees in local Vite/vinext builds, leaving the page visible but
  // without working React event handlers.
  const [api, setApi] = useState<EvalApi | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [dataState, setDataState] = useState<DataState>("connecting");
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [openingRunId, setOpeningRunId] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runCursors, setRunCursors] = useState<Record<EvalType, string | null>>(
    { e2e: null, unit: null },
  );
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [runPage, setRunPage] = useState(0);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | EvalType>("all");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<
    "all" | ExecutionStatus
  >("all");
  const [repositoryFilter, setRepositoryFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [shaFilter, setShaFilter] = useState("");
  const [stage, setStage] = useState("all");
  const [category, setCategory] = useState("all");
  const [skillFilter, setSkillFilter] = useState("all");
  const [targetEnvironment, setTargetEnvironment] = useState("all");
  const [agentName, setAgentName] = useState("all");
  const [trigger, setTrigger] = useState("all");
  const [actor, setActor] = useState("all");
  const [sortOrder, setSortOrder] = useState<RunSortOrder>("newest");
  const [startedWithin, setStartedWithin] = useState<
    "all" | "24h" | "7d" | "30d"
  >("all");
  const [minimumGateThreshold, setMinimumGateThreshold] = useState("");
  const [minimumPassRate, setMinimumPassRate] = useState("");
  const [minimumMeanScore, setMinimumMeanScore] = useState("");
  const [runGroupingLens, setRunGroupingLens] =
    useState<RunGroupingLens>("adaptive");
  const [selectedRunMetrics, setSelectedRunMetrics] = useState<string[]>([]);
  const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
  const [selectedTrend, setSelectedTrend] =
    useState<DrilldownTrendRequest | null>(null);
  const [historyFocus, setHistoryFocus] = useState<{
    type: EvalType;
    stage?: string;
    target?: string;
    skillId?: string;
    environment?: string;
    category?: string;
    targetEnvironment?: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overviewDays, setOverviewDays] = useState<7 | 30 | 90>(7);
  const [overviewType, setOverviewType] = useState<"all" | EvalType>("all");
  const [overviewInboxTab, setOverviewInboxTab] = useState<
    "blocked" | "attention"
  >("blocked");
  const [overviewShowPercentLabels, setOverviewShowPercentLabels] =
    useState(false);
  const selectedRun = useMemo(
    () =>
      selectedRunId
        ? (runs.find((run) => run.runId === selectedRunId) ?? null)
        : null,
    [runs, selectedRunId],
  );
  const hasOlderRuns = Boolean(runCursors.e2e || runCursors.unit);
  const runListFilters = useMemo(
    () => ({
      skill: skillFilter === "all" ? undefined : skillFilter,
      githubRepository: repositoryFilter.trim() || undefined,
      gitRef: branchFilter.trim() || undefined,
      gitSha: shaFilter.trim() || undefined,
      category: category === "all" ? undefined : category,
      targetEnvironment:
        targetEnvironment === "all" ? undefined : targetEnvironment,
      agentName: agentName === "all" ? undefined : agentName,
    }),
    [
      agentName,
      branchFilter,
      category,
      repositoryFilter,
      shaFilter,
      skillFilter,
      targetEnvironment,
    ],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const configured = configuredEvalApi();
      if (!configured) {
        setDataState("unconfigured");
        setLoading(false);
        return;
      }
      setApi(configured);
    });
    return () => {
      active = false;
    };
  }, []);

  const navigate = useCallback(
    (nextView: View, runId: string | null = null, replace = false) => {
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
        if (nextUrl !== currentUrl)
          window.history[replace ? "replaceState" : "pushState"](
            {},
            "",
            nextUrl,
          );
      }
    },
    [],
  );

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("view") as View | null;
      const nextView = evaluationNavItems.some((item) => item.id === requested)
        ? requested!
        : "overview";
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
      const batch = await api.listRunBatch(
        undefined,
        50,
        undefined,
        runListFilters,
      );
      setRuns(batch.items);
      setRunCursors(batch.nextCursors);
      setRunPage(0);
      setDataState("live");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to load the Eval API",
      );
      setRuns([]);
      setCases([]);
      setRunCursors({ e2e: null, unit: null });
      setDataState("error");
    } finally {
      setLoading(false);
    }
  }, [api, runListFilters]);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .listRunBatch(undefined, 50, controller.signal, runListFilters)
      .then((batch) => {
        setRuns(batch.items);
        setRunCursors(batch.nextCursors);
        setDataState("live");
        setApiError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setApiError(
          error instanceof Error
            ? error.message
            : "Unable to load the Eval API",
        );
        setRuns([]);
        setCases([]);
        setRunCursors({ e2e: null, unit: null });
        setDataState("error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, runListFilters]);

  const loadOlderRuns = useCallback(async () => {
    if (!api || !hasOlderRuns || loadingMoreRuns) return 0;
    setLoadingMoreRuns(true);
    try {
      const batch = await api.listRunBatch(
        runCursors,
        50,
        undefined,
        runListFilters,
      );
      setRunCursors(batch.nextCursors);
      setRuns((current) => {
        const byId = new Map(current.map((run) => [run.runId, run]));
        batch.items.forEach((run) => byId.set(run.runId, run));
        return Array.from(byId.values()).sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        );
      });
      return batch.items.length;
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Unable to load older runs",
      );
      return 0;
    } finally {
      setLoadingMoreRuns(false);
    }
  }, [api, hasOlderRuns, loadingMoreRuns, runCursors, runListFilters]);

  useEffect(() => {
    if (!selectedRunId || selectedRun || !api || dataState !== "live") return;
    const evalType = selectedRunId.startsWith("unit-") ? "unit" : "e2e";
    const controller = new AbortController();
    void api
      .getRun(evalType, selectedRunId, controller.signal)
      .then((run) => {
        if (!controller.signal.aborted)
          setRuns((current) =>
            current.some((item) => item.runId === run.runId)
              ? current
              : [run, ...current],
          );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(
            error instanceof Error ? error.message : "Unable to load this run",
          );
      });
    return () => controller.abort();
  }, [api, dataState, selectedRun, selectedRunId]);

  useEffect(() => {
    if (!selectedRun || !api || dataState !== "live") return;
    const controller = new AbortController();
    void api
      .listCases(selectedRun, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setCases(items.filter((item) => item.runId === selectedRun.runId));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setDetailError(
            error instanceof Error ? error.message : "Unable to load cases",
          );
      });
    return () => controller.abort();
  }, [api, dataState, selectedRun]);

  const filterOptions = useMemo(
    () => ({
      stages: Array.from(
        new Set(runs.map((run) => run.stage).filter(Boolean)),
      ).sort(),
      triggers: Array.from(
        new Set(runs.map((run) => run.trigger).filter(Boolean)),
      ).sort(),
      actors: Array.from(
        new Set(runs.map((run) => run.actor).filter(Boolean)),
      ).sort(),
      repositories: Array.from(
        new Set(
          runs
            .map((run) => run.githubRepository)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
      branches: Array.from(
        new Set(
          runs
            .filter(
              (run) =>
                !repositoryFilter ||
                run.githubRepository?.toLowerCase() ===
                  repositoryFilter.toLowerCase(),
            )
            .map((run) => run.gitRef)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
      categories: Array.from(
        new Set(
          runs
            .map((run) => run.unitConfig?.category)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
      skills: Array.from(
        new Set(
          runs
            .filter(
              (run) =>
                run.evalType === "unit" &&
                (category === "all" || run.unitConfig?.category === category),
            )
            .map((run) => run.unitConfig?.skillId ?? run.target)
            .filter(Boolean),
        ),
      ).sort(),
      targetEnvironments: Array.from(
        new Set(
          runs
            .filter(
              (run) =>
                run.evalType === "unit" &&
                (category === "all" || run.unitConfig?.category === category) &&
                (skillFilter === "all" ||
                  (run.unitConfig?.skillId ?? run.target) === skillFilter),
            )
            .map((run) => run.unitConfig?.targetEnvironment)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
      agentNames: Array.from(
        new Set(
          runs
            .filter(
              (run) =>
                run.evalType === "unit" &&
                (category === "all" || run.unitConfig?.category === category) &&
                (skillFilter === "all" ||
                  (run.unitConfig?.skillId ?? run.target) === skillFilter),
            )
            .map((run) => run.unitConfig?.agentName)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
      gateThresholds: runs.flatMap((run) => {
        const threshold =
          run.evalType === "unit"
            ? run.unitConfig?.passRateThreshold
            : run.e2eConfig?.passRateThreshold;
        return typeof threshold === "number" ? [threshold] : [];
      }),
      hasMeanScores: runs.some((run) => run.summary.meanScoreRecorded),
    }),
    [runs, repositoryFilter, category, skillFilter],
  );

  const activeMoreFilterCount =
    [
      executionStatus,
      stage,
      agentName,
      trigger,
      actor,
      startedWithin,
    ].filter((value) => value !== "all").length +
    [repositoryFilter, branchFilter, shaFilter].filter((value) =>
      Boolean(value.trim()),
    ).length +
    [minimumGateThreshold, minimumPassRate, minimumMeanScore].filter(Boolean)
      .length;

  const resetMoreFilters = () => {
    setExecutionStatus("all");
    setStage("all");
    setAgentName("all");
    setTrigger("all");
    setActor("all");
    setStartedWithin("all");
    setRepositoryFilter("");
    setBranchFilter("");
    setShaFilter("");
    setMinimumGateThreshold("");
    setMinimumPassRate("");
    setMinimumMeanScore("");
    setRunPage(0);
  };

  const filteredRuns = useMemo(
    () => {
      const matching = runs.filter((run) => {
        const haystack =
          `${run.runId} ${run.actor} ${run.stage} ${run.target} ${run.gitSha} ${run.unitConfig?.skillId ?? ""} ${run.unitConfig?.skillVersion ?? ""} ${run.unitConfig?.category ?? ""} ${run.unitConfig?.targetEnvironment ?? ""} ${run.unitConfig?.agentName ?? ""} ${run.e2eConfig?.selectedSuites.join(" ") ?? ""}`.toLowerCase();
        const hours =
          startedWithin === "24h"
            ? 24
            : startedWithin === "7d"
              ? 24 * 7
              : startedWithin === "30d"
                ? 24 * 30
                : null;
        const referenceTime = runs.reduce(
          (latest, item) =>
            Math.max(latest, new Date(item.startedAt).getTime()),
          0,
        );
        const startedMatches =
          hours === null ||
          new Date(run.startedAt).getTime() >=
            referenceTime - hours * 3_600_000;
        const configuredGate =
          run.evalType === "unit"
            ? run.unitConfig?.passRateThreshold
            : run.e2eConfig?.passRateThreshold;
        const configuredGatePct =
          typeof configuredGate === "number"
            ? configuredGate <= 1
              ? configuredGate * 100
              : configuredGate
            : null;
        const gateMatches =
          !minimumGateThreshold ||
          (configuredGatePct !== null &&
            configuredGatePct >= Number(minimumGateThreshold));
        const passRateMatches =
          !minimumPassRate ||
          run.summary.passRatePct >= Number(minimumPassRate);
        const meanScoreMatches =
          !minimumMeanScore ||
          (run.summary.meanScoreRecorded &&
            run.summary.meanScore >= Number(minimumMeanScore));
        return (
          haystack.includes(search.toLowerCase()) &&
          (type === "all" || run.evalType === type) &&
          (verdict === "all" || effectiveRunVerdict(run) === verdict) &&
          (executionStatus === "all" ||
            run.executionStatus === executionStatus) &&
          (stage === "all" || run.stage === stage) &&
          (category === "all" || run.unitConfig?.category === category) &&
          (skillFilter === "all" ||
            (run.evalType === "unit" &&
              (run.unitConfig?.skillId ?? run.target) === skillFilter)) &&
          (targetEnvironment === "all" ||
            run.unitConfig?.targetEnvironment === targetEnvironment) &&
          (agentName === "all" || run.unitConfig?.agentName === agentName) &&
          (trigger === "all" || run.trigger === trigger) &&
          (actor === "all" || run.actor === actor) &&
          gateMatches &&
          passRateMatches &&
          meanScoreMatches &&
          startedMatches
        );
      });
      return matching.sort((left, right) => {
        switch (sortOrder) {
          case "oldest":
            return left.startedAt.localeCompare(right.startedAt);
          case "pass-high":
            return right.summary.passRatePct - left.summary.passRatePct;
          case "pass-low":
            return left.summary.passRatePct - right.summary.passRatePct;
          case "score-high":
            return right.summary.meanScore - left.summary.meanScore;
          case "score-low":
            return left.summary.meanScore - right.summary.meanScore;
          default:
            return right.startedAt.localeCompare(left.startedAt);
        }
      });
    },
    [
      actor,
      agentName,
      category,
      executionStatus,
      minimumGateThreshold,
      minimumMeanScore,
      minimumPassRate,
      runs,
      search,
      skillFilter,
      sortOrder,
      stage,
      startedWithin,
      targetEnvironment,
      trigger,
      type,
      verdict,
    ],
  );
  const runPageCount = Math.max(
    1,
    Math.ceil(filteredRuns.length / RUNS_PAGE_SIZE),
  );
  const activeRunPage = Math.min(runPage, runPageCount - 1);
  const visibleRuns = filteredRuns.slice(
    activeRunPage * RUNS_PAGE_SIZE,
    (activeRunPage + 1) * RUNS_PAGE_SIZE,
  );
  const visibleStart = filteredRuns.length
    ? activeRunPage * RUNS_PAGE_SIZE + 1
    : 0;
  const visibleEnd = Math.min(
    (activeRunPage + 1) * RUNS_PAGE_SIZE,
    filteredRuns.length,
  );
  const availableRunMetrics = useMemo(
    () =>
      Array.from(
        new Set(
          filteredRuns.flatMap((run) => [
            ...(run.unitConfig?.metrics ?? []),
            ...Object.keys(run.summary.metricMeans ?? {}),
          ]),
        ),
      ).sort((left, right) => metricLabel(left).localeCompare(metricLabel(right))),
    [filteredRuns],
  );
  const visibleSelectedRunMetrics = selectedRunMetrics.filter((metric) =>
    availableRunMetrics.includes(metric),
  );

  const overview = useMemo(() => {
    const now = runs.reduce(
      (latest, run) => Math.max(latest, new Date(run.startedAt).getTime()),
      0,
    );
    const start = now - overviewDays * 86_400_000;
    const inView = runs
      .filter((run) => {
        const timestamp = new Date(run.startedAt).getTime();
        return (
          timestamp >= start &&
          timestamp <= now &&
          (overviewType === "all" || run.evalType === overviewType)
        );
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const completed = inView.filter(
      (run) => run.executionStatus === "completed",
    );
    const passed = completed.filter((run) => run.verdict === "passed").length;
    const runningRuns = inView.filter(
      (run) => run.executionStatus === "running",
    );
    const queuedRuns = inView.filter((run) => run.executionStatus === "queued");
    const blockedRuns = inView.filter(isBlockedRun);
    const attentionRuns = inView.filter(isNeedsAttentionRun);
    const p95 = percentile(
      completed.flatMap((run) =>
        typeof run.durationMs === "number" ? [run.durationMs] : [],
      ),
      0.95,
    );
    const daily = Array.from({ length: overviewDays }, (_, index) => {
      const date = new Date(now - (overviewDays - 1 - index) * 86_400_000);
      return {
        date: dateKey(date),
        e2e: undefined,
        unit: undefined,
      } as DailyTrend;
    });
    const dailyByType = (evalType: EvalType) =>
      daily.map((day) => {
        const dayRuns = completed.filter(
          (run) =>
            run.evalType === evalType && dateKey(run.startedAt) === day.date,
        );
        const total = dayRuns.reduce((sum, run) => sum + run.summary.total, 0);
        return total
          ? (dayRuns.reduce((sum, run) => sum + run.summary.passed, 0) /
              total) *
              100
          : undefined;
      });
    const e2eDaily = dailyByType("e2e");
    const unitDaily = dailyByType("unit");
    daily.forEach((day, index) => {
      day.e2e = e2eDaily[index];
      day.unit = unitDaily[index];
    });
    const recentDays = daily.slice(-Math.min(7, daily.length));
    const dailyCount = (predicate: (run: EvalRun) => boolean) =>
      recentDays.map(
        (day) =>
          inView.filter(
            (run) => dateKey(run.startedAt) === day.date && predicate(run),
          ).length,
      );
    const dailyDuration = recentDays.map((day) =>
      percentile(
        completed
          .filter((run) => dateKey(run.startedAt) === day.date)
          .flatMap((run) => (run.durationMs ? [run.durationMs] : [])),
        0.95,
      ),
    );
    const passSpark = recentDays.map((day) => {
      const values = [day.e2e, day.unit].filter(
        (value): value is number => typeof value === "number",
      );
      return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    });
    return {
      inView,
      completed,
      passed,
      runningRuns,
      queuedRuns,
      blockedRuns,
      attentionRuns,
      p95,
      daily,
      passSpark,
      failureSpark: dailyCount(
        (run) => isBlockedRun(run) || isNeedsAttentionRun(run),
      ),
      progressSpark: dailyCount(
        (run) =>
          run.executionStatus === "running" || run.executionStatus === "queued",
      ),
      durationSpark: dailyDuration,
    };
  }, [overviewDays, overviewType, runs]);

  const overviewInboxRuns =
    overviewInboxTab === "blocked"
      ? overview.blockedRuns
      : overview.attentionRuns;

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
      setRuns((current) =>
        current.some((item) => item.runId === run.runId)
          ? current.map((item) => (item.runId === run.runId ? run : item))
          : [run, ...current],
      );
      openRun(run);
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : "Unable to load this source run",
      );
    } finally {
      setOpeningRunId(null);
    }
  };

  const openHistory = (run: EvalRun) => {
    setHistoryFocus(
      run.evalType === "e2e"
        ? { type: "e2e", stage: run.stage, target: run.target }
        : {
            type: "unit",
            skillId: run.unitConfig?.skillId ?? run.target,
            environment: run.unitConfig?.bsaEnvironment ?? run.stage,
            category: run.unitConfig?.category,
            targetEnvironment: run.unitConfig?.targetEnvironment,
          },
    );
    navigate("history");
  };

  const openTrend = (request: DrilldownTrendRequest) => {
    setSelectedCase(null);
    setSelectedTrend(request);
  };

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <b aria-hidden="true">UKG</b>
            <Image
              className="brand-logo"
              src="/ukg-rgb.png"
              alt="UKG"
              width={52}
              height={34}
              unoptimized
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </span>
          <div>
            <strong>EvalHub</strong>
            <small>Quality operations</small>
          </div>
          {sidebarOpen && (
            <button
              className="sidebar-close"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          )}
        </div>
        <SidebarNavigation
          activeView={view}
          onSelectView={(nextView) => {
            navigate(nextView);
            if (nextView === "history") setHistoryFocus(null);
          }}
          onNavigate={() => setSidebarOpen(false)}
        />
        <SidebarFooter dataState={dataState} />
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            Evaluation framework <span>/</span>{" "}
            {evaluationNavItems.find((item) => item.id === view)?.label} <span>·</span>{" "}
            {dataState === "live"
              ? "Live MongoDB"
              : dataState === "connecting"
                ? "Connecting"
                : "No live data"}
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">
              ♢<i />
            </button>
            <button
              className="primary-button"
              onClick={() => void loadRuns()}
              disabled={!api || loading}
            >
              {loading ? "Refreshing…" : "↻ Refresh data"}
            </button>
          </div>
        </header>

        <div className="content">
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">Evaluation health</span>
                  <h1>Good morning, Artem</h1>
                  <p>
                    Live run health for the selected evaluation type and time
                    window.
                  </p>
                </div>
                <div className="overview-filters">
                  <div
                    className="type-switch"
                    aria-label="Overview evaluation type"
                  >
                    <button
                      className={overviewType === "all" ? "active" : ""}
                      onClick={() => setOverviewType("all")}
                    >
                      All evaluations
                    </button>
                    <button
                      className={overviewType === "e2e" ? "active" : ""}
                      onClick={() => setOverviewType("e2e")}
                    >
                      E2E
                    </button>
                    <button
                      className={overviewType === "unit" ? "active" : ""}
                      onClick={() => setOverviewType("unit")}
                    >
                      Unit
                    </button>
                  </div>
                  <div
                    className="time-filter"
                    aria-label="Overview time window"
                  >
                    {([7, 30, 90] as const).map((days) => (
                      <button
                        key={days}
                        className={overviewDays === days ? "selected" : ""}
                        onClick={() => setOverviewDays(days)}
                      >
                        {days} days
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <section className="metrics-grid">
                <MetricCard
                  label="Gate pass rate"
                  value={
                    overview.completed.length
                      ? `${Math.round((overview.passed / overview.completed.length) * 100)}%`
                      : "—"
                  }
                  note={`${overview.passed} passed · ${overview.completed.length} completed`}
                  tone="green"
                  spark={overview.passSpark}
                />
                <MetricCard
                  label="Runs in progress"
                  value={String(
                    overview.runningRuns.length + overview.queuedRuns.length,
                  )}
                  note={`${overview.runningRuns.length} running · ${overview.queuedRuns.length} queued`}
                  tone="blue"
                  spark={overview.progressSpark}
                />
                <MetricCard
                  label="Actionable runs"
                  value={String(
                    overview.blockedRuns.length + overview.attentionRuns.length,
                  )}
                  note={`${overview.blockedRuns.length} blocked · ${overview.attentionRuns.length} degraded/review`}
                  tone="red"
                  spark={overview.failureSpark}
                />
                <MetricCard
                  label="P95 duration"
                  value={overview.p95 ? formatDuration(overview.p95) : "—"}
                  note={`${overview.completed.filter((run) => run.durationMs).length} timed completed runs`}
                  tone="violet"
                  spark={overview.durationSpark}
                />
              </section>
              <section className="dashboard-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Pass rate trend</h2>
                      <p>Case-weighted daily result from completed live runs</p>
                    </div>
                    <div className="chart-heading-actions">
                      <label className="chart-label-toggle">
                        <input
                          type="checkbox"
                          checked={overviewShowPercentLabels}
                          onChange={(event) =>
                            setOverviewShowPercentLabels(event.target.checked)
                          }
                        />
                        <span>Show % labels</span>
                      </label>
                      <div className="legend">
                        {overviewType !== "unit" && (
                          <span>
                            <i className="e2e-dot" />
                            E2E
                          </span>
                        )}
                        {overviewType !== "e2e" && (
                          <span>
                            <i className="unit-dot" />
                            Unit
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <TrendChart
                    points={overview.daily}
                    type={overviewType}
                    showPercentLabels={overviewShowPercentLabels}
                  />
                </article>
                <article className="panel attention-panel">
                  <div className="panel-heading attention-panel-heading">
                    <div className="attention-heading-copy">
                      <div
                        className="attention-tabs"
                        role="tablist"
                        aria-label="Overview issue category"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={overviewInboxTab === "blocked"}
                          className={
                            overviewInboxTab === "blocked" ? "active" : ""
                          }
                          onClick={() => setOverviewInboxTab("blocked")}
                        >
                          Blocked
                          <b>{overview.blockedRuns.length}</b>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={overviewInboxTab === "attention"}
                          className={
                            overviewInboxTab === "attention" ? "active" : ""
                          }
                          onClick={() => setOverviewInboxTab("attention")}
                        >
                          Needs attention
                          <b>{overview.attentionRuns.length}</b>
                        </button>
                      </div>
                      <p>
                        {overviewInboxTab === "blocked"
                          ? "Runs stopped by setup, schema or execution blockers"
                          : "Failed, degraded, errored or XPASS runs requiring review"}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setType(overviewType);
                        setVerdict(
                          overviewInboxTab === "blocked" ? "blocked" : "all",
                        );
                        navigate("runs");
                      }}
                    >
                      {overviewInboxTab === "blocked"
                        ? "View blocked"
                        : "View all runs"}
                    </button>
                  </div>
                  <div
                    className="attention-list"
                    role="tabpanel"
                    aria-label={
                      overviewInboxTab === "blocked"
                        ? "Blocked runs"
                        : "Runs needing attention"
                    }
                  >
                    {overviewInboxRuns.slice(0, 4).map((run) => (
                      <button key={run.runId} onClick={() => openRun(run)}>
                        <span
                          className={`alert-icon ${overviewInboxTab === "blocked" ? "blocked" : run.verdict === "xpassed" ? "xpassed" : ""}`}
                        >
                          {overviewInboxTab === "blocked"
                            ? "×"
                            : run.verdict === "xpassed"
                              ? "↗"
                              : "!"}
                        </span>
                        <div>
                          <strong>{runScope(run).primary}</strong>
                          <small>
                            {run.runId} · {run.evalType.toUpperCase()}
                          </small>
                        </div>
                        <b>
                          {overviewInboxTab === "blocked"
                            ? "Blocked"
                            : attentionSignal(run)}
                        </b>
                      </button>
                    ))}
                    {!overviewInboxRuns.length && (
                      <div className="attention-empty">
                        <strong>
                          {overviewInboxTab === "blocked"
                            ? "No blocked runs in view"
                            : "No degraded runs need review"}
                        </strong>
                        <span>
                          {overviewInboxTab === "blocked"
                            ? "No runs were blocked during this time window."
                            : "Completed runs in this window meet their expected quality."}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              </section>
              <section className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent evaluation runs</h2>
                    <p>Latest activity matching the selected dashboard scope</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setType(overviewType);
                      navigate("runs");
                    }}
                  >
                    View all runs →
                  </button>
                </div>
                <RunsTable
                  runs={overview.inView.slice(0, 5)}
                  onOpen={openRun}
                />
              </section>
            </>
          )}

          {view === "runs" && (
            <>
              <div className="page-heading compact">
                <div>
                  <span className="eyebrow">Operations</span>
                  <h1>{selectedRun ? selectedRun.runId : "Evaluation runs"}</h1>
                  <p>
                    {selectedRun
                      ? "Run result, suite breakdown and case-level evidence."
                      : "Search, filter and inspect every E2E and unit evaluation."}
                  </p>
                </div>
                {selectedRun && (
                  <button
                    className="secondary-button"
                    onClick={() => navigate("runs")}
                  >
                    ← All runs
                  </button>
                )}
              </div>
              {!selectedRun ? (
                <section className="panel runs-panel">
                  <div className="filter-bar">
                    <label className="search-box">
                      <span>⌕</span>
                      <input
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setRunPage(0);
                        }}
                        placeholder="Search run, actor, SHA or target…"
                      />
                    </label>
                    <select
                      value={type}
                      onChange={(event) => {
                        setType(event.target.value as "all" | EvalType);
                        setRunPage(0);
                      }}
                      aria-label="Evaluation type"
                    >
                      <option value="all">All types</option>
                      <option value="e2e">E2E</option>
                      <option value="unit">Unit</option>
                    </select>
                    <select
                      value={verdict}
                      onChange={(event) => {
                        setVerdict(event.target.value as "all" | Verdict);
                        setRunPage(0);
                      }}
                      aria-label="Verdict"
                    >
                      <option value="all">All verdicts</option>
                      <option value="passed">Passed</option>
                      <option value="failed">Failed</option>
                      <option value="blocked">Blocked</option>
                      <option value="xpassed">XPASS</option>
                      <option value="pending">Pending</option>
                    </select>
                    <button
                      className={`filter-button ${moreFiltersOpen || activeMoreFilterCount ? "active" : ""}`}
                      aria-expanded={moreFiltersOpen}
                      aria-controls="advanced-run-filters"
                      onClick={() => setMoreFiltersOpen((open) => !open)}
                    >
                      ☷ More filters
                      {activeMoreFilterCount
                        ? ` (${activeMoreFilterCount})`
                        : ""}
                    </button>
                  </div>
                  <div className="run-scope-filters" aria-label="Evaluation scope filters">
                    <label>
                      <span>Category</span>
                      <select
                        value={category}
                        onChange={(event) => {
                          setCategory(event.target.value);
                          setSkillFilter("all");
                          setTargetEnvironment("all");
                          setAgentName("all");
                          setRunPage(0);
                        }}
                      >
                        <option value="all">All categories</option>
                        {filterOptions.categories.map((value) => (
                          <option value={value} key={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Skill</span>
                      <select
                        value={skillFilter}
                        onChange={(event) => {
                          setSkillFilter(event.target.value);
                          setTargetEnvironment("all");
                          setAgentName("all");
                          setRunPage(0);
                        }}
                      >
                        <option value="all">
                          {category === "all"
                            ? "All skills"
                            : `All skills in ${category}`}
                        </option>
                        {filterOptions.skills.map((value) => (
                          <option value={value} key={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Target environment</span>
                      <select
                        value={targetEnvironment}
                        onChange={(event) => {
                          setTargetEnvironment(event.target.value);
                          setRunPage(0);
                        }}
                      >
                        <option value="all">All targets</option>
                        {filterOptions.targetEnvironments.map((value) => (
                          <option value={value} key={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Sort within groups</span>
                      <select
                        value={sortOrder}
                        onChange={(event) => {
                          setSortOrder(event.target.value as typeof sortOrder);
                          setRunPage(0);
                        }}
                        aria-label="Sort runs"
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="pass-high">Highest pass rate</option>
                        <option value="pass-low">Lowest pass rate</option>
                        <option value="score-high">Highest mean score</option>
                        <option value="score-low">Lowest mean score</option>
                      </select>
                    </label>
                  </div>
                  {moreFiltersOpen && (
                    <div className="advanced-filters" id="advanced-run-filters">
                      <label>
                        <span>Execution status</span>
                        <select
                          value={executionStatus}
                          onChange={(event) =>
                            setExecutionStatus(
                              event.target.value as "all" | ExecutionStatus,
                            )
                          }
                        >
                          <option value="all">All statuses</option>
                          <option value="queued">Queued</option>
                          <option value="running">Running</option>
                          <option value="completed">Completed</option>
                          <option value="error">Error</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </label>
                      <label>
                        <span>Stage / environment</span>
                        <select
                          value={stage}
                          onChange={(event) => setStage(event.target.value)}
                        >
                          <option value="all">All stages</option>
                          {filterOptions.stages.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Agent</span>
                        <select
                          value={agentName}
                          onChange={(event) => {
                            setAgentName(event.target.value);
                            setRunPage(0);
                          }}
                        >
                          <option value="all">All agents</option>
                          {filterOptions.agentNames.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Trigger</span>
                        <select
                          value={trigger}
                          onChange={(event) => setTrigger(event.target.value)}
                        >
                          <option value="all">All triggers</option>
                          {filterOptions.triggers.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Actor</span>
                        <select
                          value={actor}
                          onChange={(event) => setActor(event.target.value)}
                        >
                          <option value="all">All actors</option>
                          {filterOptions.actors.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Started</span>
                        <select
                          value={startedWithin}
                          onChange={(event) =>
                            setStartedWithin(
                              event.target.value as typeof startedWithin,
                            )
                          }
                        >
                          <option value="all">Any time</option>
                          <option value="24h">Last 24 hours</option>
                          <option value="7d">Last 7 days</option>
                          <option value="30d">Last 30 days</option>
                        </select>
                      </label>
                      <label>
                        <span>Repository</span>
                        <select
                          value={repositoryFilter}
                          onChange={(event) => {
                            setRepositoryFilter(event.target.value);
                            setBranchFilter("");
                            setRunPage(0);
                          }}
                        >
                          <option value="">All repositories</option>
                          {filterOptions.repositories.map((repository) => (
                            <option key={repository} value={repository}>
                              {repository}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Branch</span>
                        <select
                          value={branchFilter}
                          onChange={(event) => {
                            setBranchFilter(event.target.value);
                            setRunPage(0);
                          }}
                        >
                          <option value="">All branches</option>
                          {filterOptions.branches.map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Commit SHA</span>
                        <input
                          type="text"
                          value={shaFilter}
                          placeholder="Full or short SHA"
                          onChange={(event) => {
                            setShaFilter(event.target.value);
                            setRunPage(0);
                          }}
                        />
                      </label>
                      <label>
                        <span>Configured gate at least</span>
                        <select
                          value={minimumGateThreshold}
                          disabled={filterOptions.gateThresholds.length === 0}
                          onChange={(event) => {
                            setMinimumGateThreshold(event.target.value);
                            setRunPage(0);
                          }}
                        >
                          <option value="">
                            {filterOptions.gateThresholds.length
                              ? "Any gate threshold"
                              : "No recorded gate thresholds"}
                          </option>
                          <option value="70">70%</option>
                          <option value="80">80%</option>
                          <option value="90">90%</option>
                          <option value="95">95%</option>
                        </select>
                      </label>
                      <label>
                        <span>Observed pass rate at least</span>
                        <select
                          value={minimumPassRate}
                          onChange={(event) => {
                            setMinimumPassRate(event.target.value);
                            setRunPage(0);
                          }}
                        >
                          <option value="">Any pass rate</option>
                          <option value="70">70%</option>
                          <option value="80">80%</option>
                          <option value="90">90%</option>
                          <option value="95">95%</option>
                          <option value="100">100%</option>
                        </select>
                      </label>
                      <label>
                        <span>Mean score at least</span>
                        <select
                          value={minimumMeanScore}
                          disabled={!filterOptions.hasMeanScores}
                          onChange={(event) => {
                            setMinimumMeanScore(event.target.value);
                            setRunPage(0);
                          }}
                        >
                          <option value="">
                            {filterOptions.hasMeanScores
                              ? "Any mean score"
                              : "No recorded mean scores"}
                          </option>
                          <option value="2">2.0</option>
                          <option value="3">3.0</option>
                          <option value="4">4.0</option>
                          <option value="4.5">4.5</option>
                          <option value="5">5.0</option>
                        </select>
                      </label>
                      <div className="advanced-filter-actions">
                        <span>
                          {activeMoreFilterCount
                            ? `${activeMoreFilterCount} advanced filter${activeMoreFilterCount === 1 ? "" : "s"} active`
                            : "No advanced filters active"}
                        </span>
                        <button
                          type="button"
                          onClick={resetMoreFilters}
                          disabled={!activeMoreFilterCount}
                        >
                          Clear advanced filters
                        </button>
                      </div>
                    </div>
                  )}
                  {(minimumGateThreshold ||
                    minimumPassRate ||
                    minimumMeanScore) && (
                    <div
                      className="active-requirement-chips"
                      aria-label="Active score requirements"
                    >
                      {minimumGateThreshold && (
                        <button
                          type="button"
                          onClick={() => setMinimumGateThreshold("")}
                        >
                          Configured gate ≥ {minimumGateThreshold}% <span>×</span>
                        </button>
                      )}
                      {minimumPassRate && (
                        <button
                          type="button"
                          onClick={() => setMinimumPassRate("")}
                        >
                          Pass rate ≥ {minimumPassRate}% <span>×</span>
                        </button>
                      )}
                      {minimumMeanScore && (
                        <button
                          type="button"
                          onClick={() => setMinimumMeanScore("")}
                        >
                          Mean score ≥ {minimumMeanScore} <span>×</span>
                        </button>
                      )}
                    </div>
                  )}
                  {(category !== "all" ||
                    skillFilter !== "all" ||
                    targetEnvironment !== "all") && (
                    <div className="active-scope-chips" aria-label="Active evaluation scope">
                      <span>Scope</span>
                      {category !== "all" && (
                        <button
                          type="button"
                          onClick={() => {
                            setCategory("all");
                            setSkillFilter("all");
                            setTargetEnvironment("all");
                          }}
                        >
                          {category} <span>×</span>
                        </button>
                      )}
                      {skillFilter !== "all" && (
                        <button
                          type="button"
                          onClick={() => {
                            setSkillFilter("all");
                            setTargetEnvironment("all");
                          }}
                        >
                          {skillFilter} <span>×</span>
                        </button>
                      )}
                      {targetEnvironment !== "all" && (
                        <button
                          type="button"
                          onClick={() => setTargetEnvironment("all")}
                        >
                          {targetEnvironment} <span>×</span>
                        </button>
                      )}
                    </div>
                  )}
                  {runGroupingLens !== "table" && (
                    <MetricMultiSelect
                      options={availableRunMetrics}
                      selected={visibleSelectedRunMetrics}
                      onChange={setSelectedRunMetrics}
                    />
                  )}
                  <section className="run-grouping-lens" aria-label="Organize matching runs">
                    <div>
                      <span>Grouping lens</span>
                      <strong>Organize the same filtered runs</strong>
                    </div>
                    <div role="group" aria-label="Group runs by">
                      {(
                        [
                          ["adaptive", "Adaptive"],
                          ["skill", "Skill → target"],
                          ["target", "Target → skill"],
                          ["attention", "Attention"],
                          ["table", "Flat table"],
                        ] as Array<[RunGroupingLens, string]>
                      ).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={runGroupingLens === value}
                          onClick={() => setRunGroupingLens(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                  {runGroupingLens === "table" ? (
                    <>
                      <RunsTable runs={visibleRuns} onOpen={openRun} />
                      <div className="table-footer">
                        <span>
                          Showing {visibleStart}–{visibleEnd} of{" "}
                          {filteredRuns.length} matching · {runs.length} loaded
                          {hasOlderRuns
                            ? " · older runs available"
                            : " · all available runs loaded"}
                        </span>
                        <div>
                          <button
                            disabled={activeRunPage === 0}
                            onClick={() =>
                              setRunPage(Math.max(0, activeRunPage - 1))
                            }
                          >
                            ←
                          </button>
                          <button
                            className="current"
                            aria-label={`Page ${activeRunPage + 1} of ${runPageCount}`}
                          >
                            {activeRunPage + 1}
                          </button>
                          <button
                            disabled={
                              loadingMoreRuns ||
                              (activeRunPage + 1 >= runPageCount &&
                                !hasOlderRuns)
                            }
                            onClick={() => {
                              if (activeRunPage + 1 < runPageCount)
                                setRunPage(activeRunPage + 1);
                              else
                                void loadOlderRuns().then((loaded) => {
                                  if (loaded) setRunPage(activeRunPage + 1);
                                });
                            }}
                          >
                            {loadingMoreRuns ? "…" : "→"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <RunGroups
                        runs={filteredRuns}
                        lens={runGroupingLens}
                        category={category}
                        skill={skillFilter}
                        targetEnvironment={targetEnvironment}
                        sortOrder={sortOrder}
                        api={api}
                        selectedMetrics={visibleSelectedRunMetrics}
                        onOpen={openRun}
                      />
                      <div className="grouped-results-footer">
                        <span>
                          {filteredRuns.length} matching · {runs.length} loaded
                          {hasOlderRuns
                            ? " · older runs available"
                            : " · all available runs loaded"}
                        </span>
                        {hasOlderRuns && (
                          <button
                            type="button"
                            disabled={loadingMoreRuns}
                            onClick={() => void loadOlderRuns()}
                          >
                            {loadingMoreRuns ? "Loading…" : "Load older runs"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              ) : (
                <RunSummary
                  run={selectedRun}
                  cases={cases}
                  onCase={setSelectedCase}
                  onHistory={openHistory}
                  onTrend={openTrend}
                />
              )}
            </>
          )}

          {dataState === "unconfigured" && (
            <div className="toast toast--error">
              <span>!</span>Eval API is not configured. Set
              NEXT_PUBLIC_EVAL_API_URL to load dashboard data.
            </div>
          )}
          {apiError && (
            <div className="toast toast--error">
              <span>!</span>
              {apiError} · no dashboard data is being substituted
            </div>
          )}
          {detailError && (
            <div className="toast toast--error">
              <span>!</span>
              {detailError} · no cross-run fallback was used
            </div>
          )}
          {view === "history" && (
            <HistoryView
              initialFocus={historyFocus}
              runs={runs}
              openingRunId={openingRunId}
              onOpenRun={(runId, evalType) => void openRunById(runId, evalType)}
            />
          )}
          {view === "compare" && (
            <CompareView runs={runs} api={api} onError={setDetailError} />
          )}
        </div>
      </main>
      {selectedCase && selectedRun && (
        <CaseDrawer
          item={selectedCase}
          run={selectedRun}
          onClose={() => setSelectedCase(null)}
          onTrend={openTrend}
        />
      )}
      {selectedTrend && (
        <DrilldownTrendDrawer
          request={selectedTrend}
          api={api}
          onClose={() => setSelectedTrend(null)}
          onOpenRun={(runId) => void openRunById(runId, selectedTrend.evalType)}
        />
      )}
    </div>
  );
}

function RunSummary({
  run,
  cases,
  onCase,
  onHistory,
  onTrend,
}: {
  run: EvalRun;
  cases: EvalCase[];
  onCase: (item: EvalCase) => void;
  onHistory: (run: EvalRun) => void;
  onTrend: (request: DrilldownTrendRequest) => void;
}) {
  const scope = runScope(run);
  const scopedCases = cases.filter((item) => item.runId === run.runId);
  const suites = summarizeCases(run, scopedCases);
  const unitMetricValues = scopedCases.flatMap((item) =>
    Object.values(item.scores ?? {}),
  );
  const unitMeanScore = unitMetricValues.length
    ? unitMetricValues.reduce((sum, score) => sum + score, 0) /
      unitMetricValues.length
    : run.summary.meanScore;
  const manifestUrl = run.evalType === "e2e" ? run.manifestUrl : undefined;
  const caseOutcomes = scopedCases.reduce(
    (counts, item) => {
      if (item.verdict === "passed") counts.passed += 1;
      if (item.verdict === "failed") counts.failed += 1;
      if (item.verdict === "blocked") counts.blocked += 1;
      if (item.verdict === "xpassed") counts.xpassed += 1;
      return counts;
    },
    { passed: 0, failed: 0, blocked: 0, xpassed: 0 },
  );
  return (
    <>
      <div className="detail-grid">
        <section className="panel run-hero">
          <div>
            <TypeBadge type={run.evalType} />
            <StatusBadge verdict={effectiveRunVerdict(run)} />
            <span className={`execution execution--${run.executionStatus}`}>
              {run.executionStatus}
            </span>
          </div>
          <h2>{scope.primary}</h2>
          <p>
            {scope.secondary} · triggered by <strong>{run.actor}</strong>{" "}
            through {run.trigger.toUpperCase()} ·{" "}
            {run.evalType === "e2e" ? (
              <>
                target manifest{" "}
                {manifestUrl ? (
                  <a
                    className="manifest-link"
                    href={manifestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {run.datasetVersion} ↗
                  </a>
                ) : (
                  <span title="The API did not return manifest_url for this run">
                    {run.datasetVersion}
                  </span>
                )}
              </>
            ) : (
              `evalset ${run.datasetVersion}`
            )}
          </p>
          <div className="run-links">
            {run.githubRunUrl && (
              <a
                className="manifest-link"
                href={run.githubRunUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub Actions run ↗
              </a>
            )}
            {run.githubJobUrl && (
              <a
                className="manifest-link"
                href={run.githubJobUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub job ↗
              </a>
            )}
          </div>
          <div className="run-metadata">
            {run.createdAt && (
              <span>
                <small>Created</small>
                {formatTime(run.createdAt)}
              </span>
            )}
            <span>
              <small>Started</small>
              {formatTime(run.startedAt)}
            </span>
            {run.completedAt && (
              <span>
                <small>Finished</small>
                {formatTime(run.completedAt)}
              </span>
            )}
            {run.gitRef && (
              <span>
                <small>Git ref</small>
                <code>{run.gitRef}</code>
              </span>
            )}
            {run.gitSha && (
              <span title={run.gitSha}>
                <small>Git SHA</small>
                <code>{shortGitSha(run.gitSha)}</code>
              </span>
            )}
            {run.githubRepository && (
              <span>
                <small>Repository</small>
                <code>{run.githubRepository}</code>
              </span>
            )}
            {run.githubRunId && (
              <span>
                <small>GitHub run</small>
                {run.githubRunUrl ? (
                  <a
                    href={run.githubRunUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {run.githubRunId} ↗
                  </a>
                ) : (
                  <code>{run.githubRunId}</code>
                )}
              </span>
            )}
            {run.githubEvent && (
              <span>
                <small>GitHub event</small>
                {run.githubEvent}
              </span>
            )}
            {run.githubRunAttempt && (
              <span>
                <small>Run attempt</small>
                {run.githubRunAttempt}
              </span>
            )}
            {run.evalType === "unit" && (
              <>
                <span>
                  <small>Category</small>
                  {run.unitConfig?.category ?? "Not recorded"}
                </span>
                <span>
                  <small>Target environment</small>
                  {run.unitConfig?.targetEnvironment ?? "Not recorded"}
                </span>
                <span>
                  <small>Agent</small>
                  {run.unitConfig?.agentName ?? "Not recorded"}
                </span>
              </>
            )}
          </div>
          {run.evalType === "e2e" ? (
            <div className="scope-chips">
              <span>Live target</span>
              <span>No tool mocks</span>
              <span>
                {run.e2eConfig?.selectedSuites.length ?? run.suites.length}{" "}
                suites
              </span>
              <span>
                Target gate ≥{" "}
                {formatPassRateThreshold(run.e2eConfig?.passRateThreshold)}
              </span>
              <span title="Highest conversation-depth tier included in this run">
                Max tier {run.e2eConfig?.maxTier ?? "not recorded"}
              </span>
            </div>
          ) : (
            <div className="scope-chips unit">
              <span>
                {run.unitConfig?.mode === "single-turn"
                  ? "Single-turn only"
                  : run.unitConfig?.mode === "multi-turn"
                    ? "Multi-turn only"
                    : "All configured test types"}
              </span>
              <span>Per-skill mocks</span>
              <span>Tool + response quality</span>
            </div>
          )}
          <button className="history-link" onClick={() => onHistory(run)}>
            View {run.evalType === "e2e" ? "target" : "skill"} history →
          </button>
          <div className="case-outcome-grid" aria-label="Case outcomes">
            <span className="case-outcome case-outcome--passed">
              <small>Passed</small>
              <strong>{caseOutcomes.passed}</strong>
            </span>
            <span className="case-outcome case-outcome--failed">
              <small>Failed</small>
              <strong>{caseOutcomes.failed}</strong>
            </span>
            <span className="case-outcome case-outcome--blocked">
              <small>Blocked</small>
              <strong>{caseOutcomes.blocked}</strong>
            </span>
            <span
              className="case-outcome case-outcome--xpassed"
              title="Unexpected passes that should be reviewed"
            >
              <small>XPASS</small>
              <strong>{caseOutcomes.xpassed}</strong>
            </span>
          </div>
          <div className="detail-stats">
            <span>
              <small>Pass rate</small>
              <strong>
                {run.evalType === "unit" ? (
                  `${run.summary.passRatePct.toFixed(run.summary.passRatePct % 1 ? 1 : 0)}%`
                ) : (
                  <>
                    {run.summary.passRatePct || "—"}
                    {run.summary.passRatePct ? "%" : ""}
                  </>
                )}
              </strong>
              {run.evalType === "e2e" && (
                <em>
                  Required:{" "}
                  {formatPassRateThreshold(run.e2eConfig?.passRateThreshold)}
                </em>
              )}
            </span>
            <span>
              <small>Mean score</small>
              <strong>
                {run.evalType === "unit"
                  ? unitMeanScore.toFixed(2)
                  : run.summary.meanScore || "—"}
              </strong>
            </span>
            <span>
              <small>Cases</small>
              <strong>{run.summary.total}</strong>
            </span>
            <span>
              <small>Duration</small>
              <strong>{formatDuration(run.durationMs)}</strong>
            </span>
          </div>
        </section>
        <section className="panel suite-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {run.evalType === "e2e"
                  ? "Suite breakdown"
                  : "Skill / metric breakdown"}
              </h2>
              <p>
                {run.evalType === "e2e"
                  ? "Live conversation result by enabled suite"
                  : "Mock-backed cases scored for this single skill"}
              </p>
            </div>
          </div>
          {suites.length ? (
            suites.map((suite) => (
              <div className="suite-row" key={suite.name}>
                <div>
                  <strong>{suite.name}</strong>
                  <small>
                    {suite.total
                      ? `${suite.passed} passed · ${suite.failed} failed`
                      : "Enabled suite · case results not available"}
                  </small>
                </div>
                <div className="suite-bar">
                  <i>
                    <b
                      style={{
                        width: `${(suite.passed / Math.max(suite.total, 1)) * 100}%`,
                      }}
                    />
                  </i>
                  <span>{suite.total ? suite.meanScore.toFixed(2) : "—"}</span>
                </div>
                <button
                  className="trend-action"
                  onClick={() =>
                    onTrend(
                      drilldownRequest(
                        run,
                        run.evalType === "unit" ? "metric" : "skill",
                        run.evalType === "unit"
                          ? (run.unitConfig?.skillId ?? run.target)
                          : suite.name,
                        undefined,
                        run.evalType === "unit" ? suite.name : undefined,
                      ),
                    )
                  }
                >
                  {run.evalType === "unit" ? "Metric trend" : "View trend"}
                </button>
              </div>
            ))
          ) : (
            <div className="empty compact-empty">
              <strong>No results yet</strong>
              <span>This run has not produced suite results.</span>
            </div>
          )}
        </section>
      </div>
      <section className="panel cases-panel">
        <div className="panel-heading">
          <div>
            <h2>Evaluated cases</h2>
            <p>Case-level verdicts, evidence and latency</p>
          </div>
          <span className="result-count">{scopedCases.length} results</span>
        </div>
        {scopedCases.length ? (
          <div className="table-wrap">
            <table className="cases-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Suite</th>
                  <th>Verdict</th>
                  <th>Score</th>
                  <th>Threshold</th>
                  <th>Latency</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scopedCases.map((item) => (
                  <tr key={item.caseId} onClick={() => onCase(item)}>
                    <td>
                      <button className="run-link">{item.caseId}</button>
                      <small>
                        <span title="Role or test type used to exercise this case">
                          {item.role}
                        </span>
                        {run.evalType === "e2e" && (
                          <>
                            {" "}
                            ·{" "}
                            <span title="Conversation-depth tier; higher tiers represent deeper or more complex flows">
                              tier {item.tier ?? "—"}
                            </span>
                          </>
                        )}
                      </small>
                    </td>
                    <td>{item.suite}</td>
                    <td>
                      <StatusBadge
                        verdict={
                          item.verdict === "error" ? "blocked" : item.verdict
                        }
                      />
                    </td>
                    <td>
                      {item.scores ? (
                        <MetricGateTags
                          scores={item.scores}
                          thresholds={item.thresholds}
                          column="score"
                        />
                      ) : (
                        <strong
                          className={
                            item.score < item.threshold ? "bad-score" : "score"
                          }
                        >
                          {item.score.toFixed(1)}
                        </strong>
                      )}
                    </td>
                    <td>
                      {item.scores ? (
                        <MetricGateTags
                          scores={item.scores}
                          thresholds={item.thresholds}
                          column="threshold"
                        />
                      ) : (
                        item.threshold.toFixed(1)
                      )}
                    </td>
                    <td>
                      {item.durationMs || item.responseTimeMs
                        ? `${((item.durationMs ?? item.responseTimeMs) / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                    <td>
                      {run.evalType === "unit" ? (
                        <button
                          className="trend-action test-trend-action"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onTrend(
                              drilldownRequest(
                                run,
                                "case",
                                run.unitConfig?.skillId ?? run.target,
                                item.caseId,
                              ),
                            );
                          }}
                        >
                          Test trend
                        </button>
                      ) : (
                        <button
                          className="row-arrow"
                          aria-label={`Open ${item.caseId}`}
                        >
                          ›
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No case documents available</strong>
            <span>No cases matching run {run.runId} were returned.</span>
          </div>
        )}
      </section>
    </>
  );
}

function CaseDrawer({
  item,
  run,
  onClose,
  onTrend,
}: {
  item: EvalCase;
  run: EvalRun;
  onClose: () => void;
  onTrend: (request: DrilldownTrendRequest) => void;
}) {
  const prompt =
    item.input ??
    "Not captured in this run result. The prompt remains defined in the authored stage suite.";
  const isMultiTurn = Boolean(item.turns?.length);
  const caseDurationMs = item.durationMs ?? item.responseTimeMs;
  return (
    <div
      className="drawer-layer"
      role="dialog"
      aria-modal="true"
      aria-label={`Evaluation case ${item.caseId}`}
    >
      <button
        className="drawer-backdrop"
        onClick={onClose}
        aria-label="Close case detail"
      />
      <aside className="case-drawer">
        <header>
          <div>
            <span className="eyebrow">Case evidence</span>
            <h2>{item.testName || item.caseId}</h2>
            {item.testName && <p className="drawer-case-id">{item.caseId}</p>}
          </div>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="drawer-body">
          <button
            className="case-trend-button"
            onClick={() =>
              onTrend(
                drilldownRequest(
                  run,
                  "case",
                  item.skill || item.suite,
                  item.caseId,
                ),
              )
            }
          >
            ↗ View this {run.evalType === "unit" ? "test" : "case"} over time
          </button>
          <div className="case-summary">
            <StatusBadge
              verdict={item.verdict === "error" ? "blocked" : item.verdict}
            />
            <span>
              {item.scores ? (
                <>
                  <strong>{Object.keys(item.scores).length}</strong> case-level
                  metric{Object.keys(item.scores).length === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  Score <strong>{item.score.toFixed(1)}</strong> / case
                  threshold {item.threshold.toFixed(1)}
                </>
              )}
            </span>
            <span>
              {caseDurationMs
                ? `${(caseDurationMs / 1000).toFixed(2)}s`
                : "duration not recorded"}
            </span>
          </div>
          {item.verdict === "xpassed" && (
            <div className="xpass-note">
              <strong>Unexpected pass</strong>
              <span>
                This case is marked as a known or expected failure, but it
                passed. Review the known-bug marker and linked issue; the
                expected-failure annotation may now be stale.
              </span>
            </div>
          )}
          <dl
            className={`meta-grid ${run.evalType === "unit" ? "meta-grid--unit" : ""}`}
          >
            <div>
              <dt>Suite</dt>
              <dd>{item.suite}</dd>
            </div>
            <div>
              <dt>Role / type</dt>
              <dd>{item.role}</dd>
            </div>
            {run.evalType === "e2e" && (
              <div>
                <dt>Tier</dt>
                <dd>{item.tier ?? "—"}</dd>
              </div>
            )}
            <div>
              <dt>Skill</dt>
              <dd>{item.skill}</dd>
            </div>
          </dl>
          {item.startedAt && (
            <div className="case-timing">
              <span>Started {formatTime(item.startedAt)}</span>
              {item.finishedAt && (
                <span>Finished {formatTime(item.finishedAt)}</span>
              )}
            </div>
          )}

          {isMultiTurn ? (
            <TurnTimeline turns={item.turns ?? []} />
          ) : (
            <>
              <EvidenceBlock
                title="Prompt"
                content={prompt}
                tone={item.input ? "default" : "muted"}
              />
              {item.expectedResponse && (
                <EvidenceBlock
                  title="Expected response"
                  content={item.expectedResponse}
                />
              )}
              <EvidenceBlock
                title="Assistant response"
                content={item.responseText || "No response stored"}
              />
              {item.toolCalls?.length ? (
                <ToolCallList calls={item.toolCalls} />
              ) : null}
            </>
          )}

          {item.scores && (
            <ScoreBreakdown
              scores={item.scores}
              thresholds={item.thresholds}
              explanations={item.scoreExplanations}
              failed={item.verdict === "failed"}
            />
          )}
          {item.validationResult != null && (
            <EvidenceBlock
              title="Validation result"
              content={formatEvidence(item.validationResult)}
              tone={item.verdict === "failed" ? "danger" : "default"}
            />
          )}
          {run.evalType === "unit" ? (
            <>
              <EvidenceBlock
                title="Expected trajectory"
                content={
                  item.expectedTrajectory == null
                    ? "Not recorded"
                    : formatEvidence(item.expectedTrajectory)
                }
                tone={item.expectedTrajectory == null ? "muted" : "default"}
              />
              <EvidenceBlock
                title="Predicted trajectory"
                content={
                  item.predictedTrajectory == null
                    ? "Not recorded"
                    : formatEvidence(item.predictedTrajectory)
                }
                tone={item.predictedTrajectory == null ? "muted" : "default"}
              />
            </>
          ) : (
            <>
              {item.expectedTrajectory != null && (
                <EvidenceBlock
                  title="Expected trajectory"
                  content={formatEvidence(item.expectedTrajectory)}
                />
              )}
              {item.predictedTrajectory != null && (
                <EvidenceBlock
                  title="Observed trajectory"
                  content={formatEvidence(item.predictedTrajectory)}
                />
              )}
            </>
          )}
          {!item.scoreExplanations && item.explanation && (
            <EvidenceBlock
              title="Judge explanation"
              content={item.explanation}
              tone={item.verdict === "failed" ? "danger" : "default"}
            />
          )}
          {item.bugRef && (
            <div className="bug-ref">
              <span>Linked issue</span>
              <strong>{item.bugRef}</strong>
            </div>
          )}
          {item.error && (
            <EvidenceBlock
              title="Execution error"
              content={item.error}
              tone="danger"
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function formatEvidence(value: unknown) {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? String(value));
}

function ToolCallList({ calls }: { calls: EvalCase["toolCalls"] }) {
  if (!calls?.length) return null;
  return (
    <section className="tool-call-list">
      <h3>Observed tool calls</h3>
      {calls.map((call, index) => (
        <article key={call.toolCallId ?? `${call.name}-${index}`}>
          <div>
            <strong>{call.name}</strong>
            {call.toolCallId && <code>{call.toolCallId}</code>}
          </div>
          <pre>{JSON.stringify(call.parameters, null, 2)}</pre>
        </article>
      ))}
    </section>
  );
}

function ScoreBreakdown({
  scores,
  thresholds,
  explanations,
  failed,
}: {
  scores: Record<string, number>;
  thresholds?: Record<string, number>;
  explanations?: Record<string, string>;
  failed: boolean;
}) {
  return (
    <section
      className={`score-breakdown ${failed ? "score-breakdown--failed" : ""}`}
    >
      <h3>Metric results</h3>
      {Object.entries(scores).map(([metric, score]) => {
        const threshold = thresholds?.[metric];
        const hasThreshold = typeof threshold === "number";
        const passed = hasThreshold ? score >= threshold : undefined;
        return (
          <article
            className={
              passed === undefined
                ? "metric-result--unknown"
                : passed
                  ? "metric-result--pass"
                  : "metric-result--fail"
            }
            key={metric}
          >
            <div>
              <strong>{metric.replaceAll("_", " ")}</strong>
              <span className="metric-result-gate">
                <b>{score.toFixed(1)}</b>
                {hasThreshold ? (
                  <em>
                    {passed ? "Passed" : "Failed"} · threshold{" "}
                    {threshold.toFixed(1)}
                  </em>
                ) : (
                  <em>Threshold not recorded</em>
                )}
              </span>
            </div>
            {explanations?.[metric] && <p>{explanations[metric]}</p>}
          </article>
        );
      })}
    </section>
  );
}

function TurnTimeline({ turns }: { turns: EvalTurn[] }) {
  return (
    <section className="turn-timeline">
      <div className="turn-timeline-heading">
        <div>
          <span className="eyebrow">Multi-turn conversation</span>
          <h3>{turns.length} recorded turns</h3>
        </div>
        <span>Ordered execution evidence</span>
      </div>
      {[...turns]
        .sort((left, right) => left.turnNumber - right.turnNumber)
        .map((turn) => (
          <article className="turn-card" key={turn.turnNumber}>
            <div className="turn-marker">
              <span>{turn.turnNumber}</span>
            </div>
            <div className="turn-content">
              <header>
                <strong>Turn {turn.turnNumber}</strong>
                <span>
                  {turn.toolCalls.length} tool call
                  {turn.toolCalls.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="turn-response">
                <span>Assistant response</span>
                <p>{turn.response || "No response stored for this turn."}</p>
              </div>
              <ToolCallList calls={turn.toolCalls} />
              {Object.keys(turn.scores).length > 0 && (
                <ScoreBreakdown scores={turn.scores} failed={false} />
              )}
              {turn.validationResult != null && (
                <EvidenceBlock
                  title="Turn validation"
                  content={formatEvidence(turn.validationResult)}
                />
              )}
            </div>
          </article>
        ))}
    </section>
  );
}

function EvidenceBlock({
  title,
  content,
  tone = "default",
}: {
  title: string;
  content: string;
  tone?: "default" | "danger" | "muted";
}) {
  return (
    <section className={`evidence evidence--${tone}`}>
      <h3>{title}</h3>
      <p>{content}</p>
    </section>
  );
}

function DrilldownScoreChart({
  points,
  onOpenRun,
}: {
  points: DrilldownTrendPoint[];
  onOpenRun: (runId: string) => void;
}) {
  const width = 760;
  const left = 42;
  const right = 728;
  const top = 22;
  const bottom = 178;
  const x = (index: number) =>
    points.length < 2
      ? (left + right) / 2
      : left + (index / (points.length - 1)) * (right - left);
  const y = (score: number) => top + ((5 - score) / 5) * (bottom - top);
  const scoreLine = points
    .map((point, index) => `${x(index)},${y(point.score)}`)
    .join(" ");
  const thresholdLine = points
    .map((point, index) => `${x(index)},${y(point.threshold)}`)
    .join(" ");
  return (
    <div
      className="drilldown-chart"
      role="img"
      aria-label="Score and threshold over time"
    >
      <svg viewBox={`0 0 ${width} 218`} preserveAspectRatio="none">
        <g className="drilldown-grid">
          {[5, 4, 3, 2, 1, 0].map((value) => (
            <g key={value}>
              <line x1={left} x2={right} y1={y(value)} y2={y(value)} />
              <text x="12" y={y(value) + 3}>
                {value}
              </text>
            </g>
          ))}
        </g>
        {points.length > 1 && (
          <>
            <polyline
              className="drilldown-threshold-line"
              points={thresholdLine}
            />
            <polyline className="drilldown-score-line" points={scoreLine} />
          </>
        )}
        {points.map((point, index) => (
          <g
            className="drilldown-point"
            key={`${point.runId}-${point.startedAt}`}
            onClick={() => onOpenRun(point.runId)}
            role="button"
          >
            <circle
              className={`drilldown-dot drilldown-dot--${point.verdict}`}
              cx={x(index)}
              cy={y(point.score)}
              r="5"
            >
              <title>{`${formatTime(point.startedAt)} · score ${point.score.toFixed(2)} · ${point.verdict}`}</title>
            </circle>
            <text
              className="drilldown-value"
              x={x(index)}
              y={Math.max(12, y(point.score) - 11)}
              textAnchor="middle"
            >
              {point.score.toFixed(1)}
            </text>
            <text
              className="point-date"
              x={x(index)}
              y="207"
              textAnchor="middle"
            >
              {formatDateShort(point.startedAt)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DrilldownTrendDrawer({
  request,
  api,
  onClose,
  onOpenRun,
}: {
  request: DrilldownTrendRequest;
  api: EvalApi | null;
  onClose: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const [points, setPoints] = useState<DrilldownTrendPoint[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return;
        setLoading(true);
        setError(null);
        setNextCursor(null);
        setPoints([]);
        if (!api)
          throw new Error(
            "Eval API is not configured. Trend data is unavailable.",
          );
        return api.listTrend(request, null, 30, controller.signal);
      })
      .then((page) => {
        if (controller.signal.aborted || !page) return;
        setPoints(
          page.items.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
        );
        setNextCursor(page.nextCursor);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load trend data",
          );
      })
      .finally(() => {
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
        return Array.from(byRun.values()).sort((a, b) =>
          a.startedAt.localeCompare(b.startedAt),
        );
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load older trend data",
      );
    } finally {
      setLoadingOlder(false);
    }
  };
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const delta = latest && previous ? latest.score - previous.score : 0;
  const nonPasses = points.filter(
    (point) => point.verdict !== "passed" && point.verdict !== "xpassed",
  ).length;
  const title =
    request.kind === "case"
      ? (request.caseId ?? request.skill)
      : request.kind === "metric"
        ? (request.metric ?? request.skill)
        : request.skill;
  const trendLabel =
    request.kind === "metric"
      ? "Metric trend"
      : request.kind === "case" && request.evalType === "unit"
        ? "Test trend"
        : request.kind === "case"
          ? "Case history"
          : "Skill trend";
  return (
    <div
      className="drawer-layer"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} historical trend`}
    >
      <button
        className="drawer-backdrop"
        onClick={onClose}
        aria-label="Close trend"
      />
      <aside className="case-drawer trend-drawer">
        <header>
          <div>
            <span className="eyebrow">{trendLabel}</span>
            <h2>{title}</h2>
            <p>
              <TypeBadge type={request.evalType} />{" "}
              {request.evalType === "e2e"
                ? `${request.stage} · ${request.target}`
                : `${request.environment} · ${request.skill}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="drawer-body">
          {loading ? (
            <div className="trend-loading">
              <span />
              <span />
              <span />
              Loading historical cases…
            </div>
          ) : error && !points.length ? (
            <div className="trend-error">
              <strong>Trend could not be loaded</strong>
              <span>{error}</span>
            </div>
          ) : points.length ? (
            <>
              <div className="trend-kpis">
                <article>
                  <span>Latest score</span>
                  <strong>{latest?.score.toFixed(2)}</strong>
                  <small>threshold {latest?.threshold.toFixed(2)}</small>
                </article>
                <article>
                  <span>Change</span>
                  <strong className={delta >= 0 ? "delta-good" : "delta-bad"}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(2)}
                  </strong>
                  <small>vs previous matching run</small>
                </article>
                <article>
                  <span>History loaded</span>
                  <strong>{points.length}</strong>
                  <small>{nonPasses} failed or blocked</small>
                </article>
              </div>
              <section className="trend-chart-card">
                <div className="trend-chart-heading">
                  <div>
                    <h3>Score over time</h3>
                    <p>
                      Matching{" "}
                      {request.evalType === "e2e"
                        ? "stage, target and suite"
                        : request.kind === "metric"
                          ? "environment, skill and metric"
                          : request.kind === "case"
                            ? "environment, skill and test"
                            : "environment and skill"}
                      ; points open the source run.
                    </p>
                  </div>
                  <div className="drilldown-legend">
                    <span>
                      <i />
                      Score
                    </span>
                    <span>
                      <i />
                      Threshold
                    </span>
                  </div>
                </div>
                <DrilldownScoreChart points={points} onOpenRun={onOpenRun} />
              </section>
              <div className="trend-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>
                        {request.evalType === "unit"
                          ? "Skill version"
                          : "Dataset"}
                      </th>
                      <th>Verdict</th>
                      <th>Score / gate</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...points].reverse().map((point) => (
                      <tr
                        key={`${point.runId}-${point.startedAt}`}
                        onClick={() => onOpenRun(point.runId)}
                      >
                        <td>
                          <button className="run-link">{point.runId}</button>
                        </td>
                        <td>
                          {request.evalType === "unit"
                            ? `v${point.skillVersion ?? "unknown"} · BSA ${point.bsaVersion ?? "unknown"}`
                            : point.datasetVersion}
                        </td>
                        <td>
                          <StatusBadge verdict={point.verdict} />
                        </td>
                        <td>
                          <strong>{point.score.toFixed(2)}</strong> /{" "}
                          {point.threshold.toFixed(2)}
                        </td>
                        <td>{formatTime(point.startedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && (
                <div className="trend-error">
                  <span>{error}</span>
                </div>
              )}
              {nextCursor && (
                <button
                  className="secondary-button trend-load-more"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder
                    ? "Loading older runs…"
                    : "Load 30 older matching runs"}
                </button>
              )}
            </>
          ) : (
            <div className="trend-empty">
              <strong>No matching history yet</strong>
              <span>
                This view keeps{" "}
                {request.evalType === "e2e" ? "E2E target" : "unit environment"}{" "}
                results separate. More completed matching runs are needed before
                a trend can be drawn.
              </span>
              {nextCursor && (
                <button
                  className="secondary-button"
                  onClick={() => void loadOlder()}
                >
                  Search older runs
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

type HistoryFocus = {
  type: EvalType;
  stage?: string;
  target?: string;
  skillId?: string;
  environment?: string;
  category?: string;
  targetEnvironment?: string;
} | null;
type TrendPoint = {
  id: string;
  startedAt: string;
  passRatePct: number;
  meanScore: number;
  meanScoreRecorded?: boolean;
  totalCases: number;
  durationMs: number;
  verdict: Verdict;
  scope: string;
  batchId?: string;
  githubRunId?: string;
  githubRunUrl?: string;
  gitSha?: string;
  category?: string;
  targetEnvironment?: string;
  agentName?: string;
  skillVersion?: string;
};

function aggregateE2E(points: E2EHistoryPoint[]): TrendPoint[] {
  const groups = new Map<string, E2EHistoryPoint[]>();
  points.forEach((point) => {
    const batchId = point.batchId ?? point.runId;
    groups.set(batchId, [...(groups.get(batchId) ?? []), point]);
  });
  return Array.from(groups.entries())
    .map(([batchId, items]) => {
      const totalCases = items.reduce((sum, item) => sum + item.totalCases, 0);
      const weighted = (key: "passRatePct" | "meanScore") =>
        totalCases
          ? items.reduce((sum, item) => sum + item[key] * item.totalCases, 0) /
            totalCases
          : 0;
      const passRatePct = weighted("passRatePct");
      const verdict: Verdict = items.some((item) => item.verdict === "blocked")
        ? "blocked"
        : passRatePct < 90
          ? "failed"
          : items.some((item) => item.verdict === "xpassed")
            ? "xpassed"
            : "passed";
      return {
        id: batchId,
        batchId,
        startedAt: items[0].startedAt,
        passRatePct,
        meanScore: weighted("meanScore"),
        totalCases,
        durationMs: Math.max(...items.map((item) => item.durationMs)),
        verdict,
        scope: `${items.length} targets`,
        githubRunId: items[0].githubRunId,
        githubRunUrl: items[0].githubRunUrl,
        gitSha: items[0].gitSha,
      };
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function HistoryChart({
  points,
  title,
  windowDays,
  windowEnd,
  showPercentLabels,
  onShowPercentLabelsChange,
}: {
  points: TrendPoint[];
  title: string;
  windowDays: 7 | 30 | 90;
  windowEnd: number;
  showPercentLabels: boolean;
  onShowPercentLabelsChange: (show: boolean) => void;
}) {
  const width = 1400;
  const plotLeft = 70;
  const plotRight = 1360;
  const plotTop = 18;
  const plotBottom = 140;
  const windowStart = windowEnd - windowDays * 86_400_000;
  const windowDuration = Math.max(windowEnd - windowStart, 1);
  const x = (startedAt: string) => {
    const timestamp = new Date(startedAt).getTime();
    const progress = Math.min(
      1,
      Math.max(0, (timestamp - windowStart) / windowDuration),
    );
    return plotLeft + progress * (plotRight - plotLeft);
  };
  const y = (percent: number) =>
    plotTop + ((100 - percent) / 100) * (plotBottom - plotTop);
  const passPoints = points
    .map((point) => `${x(point.startedAt)},${y(point.passRatePct)}`)
    .join(" ");
  const scorePoints = points
    .map((point) => `${x(point.startedAt)},${y((point.meanScore / 5) * 100)}`)
    .join(" ");
  const dateTicks = Array.from({ length: 7 }, (_, index) => {
    const timestamp = windowStart + (index / 6) * windowDuration;
    return { timestamp, x: plotLeft + (index / 6) * (plotRight - plotLeft) };
  });
  return (
    <section className="panel history-chart-card">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>
            Pass rate and normalized mean score across the selected {windowDays}
            -day window
          </p>
        </div>
        <div className="chart-heading-actions">
          <label className="chart-label-toggle">
            <input
              type="checkbox"
              checked={showPercentLabels}
              onChange={(event) =>
                onShowPercentLabelsChange(event.target.checked)
              }
            />
            <span>Show % labels</span>
          </label>
          <div className="history-legend">
            <span>
              <i />
              Pass rate
            </span>
            <span>
              <i />
              Mean score
            </span>
            <span>
              <i />
              90% gate
            </span>
          </div>
        </div>
      </div>
      <div
        className="history-chart"
        role="img"
        aria-label={`${title} ${windowDays}-day historical trend`}
      >
        <svg viewBox={`0 0 ${width} 180`} preserveAspectRatio="xMidYMid meet">
          <g className="history-grid">
            {[100, 75, 50, 25, 0].map((value) => (
              <g key={value}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y(value)}
                  y2={y(value)}
                />
                <text x="7" y={y(value) + 3}>
                  {value}%
                </text>
              </g>
            ))}
          </g>
          <line
            className="gate-line"
            x1={plotLeft}
            x2={plotRight}
            y1={y(90)}
            y2={y(90)}
          />
          {points.length > 1 && (
            <>
              <polyline className="history-pass-line" points={passPoints} />
              <polyline className="history-score-line" points={scorePoints} />
            </>
          )}
          {points.map((point) => (
            <g key={point.id}>
              <circle
                className="history-pass-dot"
                cx={x(point.startedAt)}
                cy={y(point.passRatePct)}
                r="4"
              >
                <title>
                  {point.passRatePct.toFixed(1)}% pass rate ·{" "}
                  {formatTime(point.startedAt)}
                </title>
              </circle>
              <circle
                className="history-score-dot"
                cx={x(point.startedAt)}
                cy={y((point.meanScore / 5) * 100)}
                r="3"
              >
                <title>
                  {point.meanScore.toFixed(2)} mean score ·{" "}
                  {formatTime(point.startedAt)}
                </title>
              </circle>
              {showPercentLabels && (
                <text
                  className="point-value"
                  x={x(point.startedAt)}
                  y={Math.max(12, y(point.passRatePct) - 10)}
                  textAnchor="middle"
                >
                  {point.passRatePct.toFixed(point.passRatePct % 1 ? 1 : 0)}%
                </text>
              )}
            </g>
          ))}
          {dateTicks.map((tick) => (
            <text
              key={tick.timestamp}
              className="point-date"
              x={tick.x}
              y="169"
              textAnchor="middle"
            >
              {formatDateShort(new Date(tick.timestamp).toISOString())}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}

const comparisonPalette = ["#15947f", "#637dcb", "#d88942", "#ad5b9e", "#3e8eb8"];

function TargetComparisonChart({
  points,
  title,
  windowDays,
  windowEnd,
}: {
  points: TrendPoint[];
  title: string;
  windowDays: 7 | 30 | 90;
  windowEnd: number;
}) {
  const width = 1400;
  const plotLeft = 70;
  const plotRight = 1360;
  const plotTop = 18;
  const plotBottom = 140;
  const windowStart = windowEnd - windowDays * 86_400_000;
  const windowDuration = Math.max(windowEnd - windowStart, 1);
  const x = (startedAt: string) =>
    plotLeft +
    Math.min(
      1,
      Math.max(
        0,
        (new Date(startedAt).getTime() - windowStart) / windowDuration,
      ),
    ) *
      (plotRight - plotLeft);
  const y = (percent: number) =>
    plotTop + ((100 - percent) / 100) * (plotBottom - plotTop);
  const groups = Array.from(
    points.reduce((byTarget, point) => {
      byTarget.set(point.scope, [...(byTarget.get(point.scope) ?? []), point]);
      return byTarget;
    }, new Map<string, TrendPoint[]>()),
  );
  const dateTicks = Array.from({ length: 7 }, (_, index) => {
    const timestamp = windowStart + (index / 6) * windowDuration;
    return { timestamp, x: plotLeft + (index / 6) * (plotRight - plotLeft) };
  });

  return (
    <section className="panel history-chart-card target-comparison-chart">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>Pass rate by target environment · lines remain separate for comparison</p>
        </div>
        <div className="target-comparison-legend">
          {groups.map(([target], index) => (
            <span key={target}>
              <i style={{ background: comparisonPalette[index % comparisonPalette.length] }} />
              {target}
            </span>
          ))}
        </div>
      </div>
      <div
        className="history-chart"
        role="img"
        aria-label={`${title} target environment comparison`}
      >
        <svg viewBox={`0 0 ${width} 180`} preserveAspectRatio="xMidYMid meet">
          <g className="history-grid">
            {[100, 75, 50, 25, 0].map((value) => (
              <g key={value}>
                <line x1={plotLeft} x2={plotRight} y1={y(value)} y2={y(value)} />
                <text x="7" y={y(value) + 3}>{value}%</text>
              </g>
            ))}
          </g>
          <line
            className="gate-line"
            x1={plotLeft}
            x2={plotRight}
            y1={y(90)}
            y2={y(90)}
          />
          {groups.map(([target, targetPoints], index) => {
            const color = comparisonPalette[index % comparisonPalette.length];
            const ordered = [...targetPoints].sort((a, b) =>
              a.startedAt.localeCompare(b.startedAt),
            );
            return (
              <g key={target}>
                {ordered.length > 1 && (
                  <polyline
                    className="target-comparison-line"
                    stroke={color}
                    points={ordered
                      .map(
                        (point) =>
                          `${x(point.startedAt)},${y(point.passRatePct)}`,
                      )
                      .join(" ")}
                  />
                )}
                {ordered.map((point) => (
                  <circle
                    key={point.id}
                    className="target-comparison-dot"
                    stroke={color}
                    cx={x(point.startedAt)}
                    cy={y(point.passRatePct)}
                    r="4"
                  >
                    <title>
                      {target} · {point.passRatePct.toFixed(1)}% · {formatTime(point.startedAt)}
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
          {dateTicks.map((tick) => (
            <text
              key={tick.timestamp}
              className="point-date"
              x={tick.x}
              y="169"
              textAnchor="middle"
            >
              {formatDateShort(new Date(tick.timestamp).toISOString())}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}

function HistoryView({
  initialFocus,
  runs,
  openingRunId,
  onOpenRun,
}: {
  initialFocus: HistoryFocus;
  runs: EvalRun[];
  openingRunId: string | null;
  onOpenRun: (runId: string, evalType: EvalType) => void;
}) {
  const e2eSource = runs
    .filter((run) => run.evalType === "e2e" && isTerminalHistoryRun(run))
    .map((run) => ({
      runId: run.runId,
      batchId: run.batchId ?? run.runId,
      githubRunId: run.githubRunId,
      githubRunUrl: run.githubRunUrl,
      gitSha: run.gitSha,
      startedAt: run.startedAt,
      stage: run.stage,
      target: run.target,
      passRatePct: run.summary.passRatePct,
      meanScore: run.summary.meanScore,
      totalCases: run.summary.total,
      durationMs: run.durationMs ?? 0,
      verdict: run.verdict,
    }));
  const unitSource = runs
    .filter((run) => run.evalType === "unit" && isTerminalHistoryRun(run))
    .map((run) => ({
      runId: run.runId,
      batchId: run.batchId,
      githubRunId: run.githubRunId,
      githubRunUrl: run.githubRunUrl,
      gitSha: run.gitSha,
      gitRef: run.gitRef,
      startedAt: run.startedAt,
      skillId: run.unitConfig?.skillId ?? run.target,
      environment: run.unitConfig?.bsaEnvironment ?? run.stage,
      category: run.unitConfig?.category?.trim() || "Uncategorized",
      targetEnvironment:
        run.unitConfig?.targetEnvironment?.trim() || "Target not recorded",
      agentName: run.unitConfig?.agentName?.trim() || "Agent not recorded",
      skillVersion: run.unitConfig?.skillVersion?.trim() || "Version not recorded",
      passRatePct: run.summary.passRatePct,
      meanScore: run.summary.meanScore,
      meanScoreRecorded: run.summary.meanScoreRecorded,
      generalQuality: 0,
      toolUseQuality: 0,
      totalCases: run.summary.total,
      durationMs: run.durationMs ?? 0,
      verdict: run.verdict,
    }));
  const stages = Array.from(new Set(e2eSource.map((point) => point.stage)));
  const categories = Array.from(
    new Set(unitSource.map((point) => point.category)),
  ).sort();
  const initialCategory =
    initialFocus?.category && categories.includes(initialFocus.category)
      ? initialFocus.category
      : initialFocus?.skillId
        ? (unitSource.find((point) => point.skillId === initialFocus.skillId)
            ?.category ?? categories[0] ?? "Uncategorized")
      : (categories[0] ?? "Uncategorized");
  const initialCategorySkills = Array.from(
    new Set(
      unitSource
        .filter((point) => point.category === initialCategory)
        .map((point) => point.skillId),
    ),
  ).sort();
  const initialStage =
    initialFocus?.stage && stages.includes(initialFocus.stage)
      ? initialFocus.stage
      : (stages[0] ?? "");
  const initialSkill =
    initialFocus?.skillId && initialCategorySkills.includes(initialFocus.skillId)
      ? initialFocus.skillId
      : "all";
  const [historyType, setHistoryType] = useState<EvalType>(
    initialFocus?.type ?? "e2e",
  );
  const [stage, setStage] = useState(initialStage);
  const stageTargets = Array.from(
    new Set(
      e2eSource
        .filter((point) => point.stage === stage)
        .map((point) => point.target),
    ),
  );
  const [target, setTarget] = useState(
    initialFocus?.target && stageTargets.includes(initialFocus.target)
      ? initialFocus.target
      : "all",
  );
  const [skillId, setSkillId] = useState(initialSkill);
  const [category, setCategory] = useState(initialCategory);
  const [environment, setEnvironment] = useState(
    initialFocus?.environment ?? "all",
  );
  const [targetEnvironments, setTargetEnvironments] = useState<string[]>(
    initialFocus?.targetEnvironment ? [initialFocus.targetEnvironment] : [],
  );
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const [showPercentLabels, setShowPercentLabels] = useState(false);

  const rangeDays: 7 | 30 | 90 = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const referenceTime = runs.reduce(
    (latest, run) => Math.max(latest, new Date(run.startedAt).getTime()),
    0,
  );
  const rangeStart = referenceTime - rangeDays * 86_400_000;
  const inRange = (startedAt: string) => {
    const timestamp = new Date(startedAt).getTime();
    return (
      referenceTime > 0 && timestamp >= rangeStart && timestamp <= referenceTime
    );
  };

  const e2eStageInRange = e2eSource.filter(
    (point) => inRange(point.startedAt) && point.stage === stage,
  );
  const e2eFiltered = e2eStageInRange.filter(
    (point) => target === "all" || point.target === target,
  );
  const e2eTrend: TrendPoint[] =
    target === "all"
      ? aggregateE2E(e2eFiltered)
      : e2eFiltered
          .map((point) => ({
            id: point.runId,
            startedAt: point.startedAt,
            passRatePct: point.passRatePct,
            meanScore: point.meanScore,
            totalCases: point.totalCases,
            durationMs: point.durationMs,
            verdict: point.verdict,
            scope: point.target,
            batchId: point.batchId,
            githubRunId: point.githubRunId,
            githubRunUrl: point.githubRunUrl,
            gitSha: point.gitSha,
          }))
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const skills = Array.from(
    new Set(
      unitSource
        .filter((point) => point.category === category)
        .map((point) => point.skillId),
    ),
  ).sort();
  const environments = Array.from(
    new Set(
      unitSource
        .filter(
          (point) =>
            point.category === category &&
            (skillId === "all" || point.skillId === skillId),
        )
        .map((point) => point.environment),
    ),
  ).sort();
  const availableTargetEnvironments = Array.from(
    new Set(
      unitSource
        .filter(
          (point) =>
            point.category === category &&
            (skillId === "all" || point.skillId === skillId) &&
            (environment === "all" || point.environment === environment),
        )
        .map((point) => point.targetEnvironment),
    ),
  ).sort();
  const unitFiltered = unitSource
    .filter(
      (point) =>
        inRange(point.startedAt) &&
        point.category === category &&
        (skillId === "all" || point.skillId === skillId) &&
        (environment === "all" || point.environment === environment) &&
        (targetEnvironments.length === 0 ||
          targetEnvironments.includes(point.targetEnvironment)),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const unitTrend: TrendPoint[] = unitFiltered.map((point) => ({
    id: point.runId,
    startedAt: point.startedAt,
    passRatePct: point.passRatePct,
    meanScore: point.meanScore,
    meanScoreRecorded: point.meanScoreRecorded,
    totalCases: point.totalCases,
    durationMs: point.durationMs,
    verdict: point.verdict,
    scope: skillId === "all" ? point.skillId : point.targetEnvironment,
    batchId: point.batchId,
    githubRunId: point.githubRunId,
    githubRunUrl: point.githubRunUrl,
    gitSha: point.gitSha,
    category: point.category,
    targetEnvironment: point.targetEnvironment,
    agentName: point.agentName,
    skillVersion: point.skillVersion,
  }));
  const trend = historyType === "e2e" ? e2eTrend : unitTrend;
  const historyVerdicts = trend.reduce(
    (counts, point) => {
      if (point.verdict === "passed") counts.passed += 1;
      if (point.verdict === "failed") counts.failed += 1;
      if (point.verdict === "blocked") counts.blocked += 1;
      if (point.verdict === "xpassed") counts.xpassed += 1;
      return counts;
    },
    { passed: 0, failed: 0, blocked: 0, xpassed: 0 },
  );
  const latest = trend.at(-1);
  const previous = trend.at(-2);
  const passDelta =
    latest && previous ? latest.passRatePct - previous.passRatePct : 0;
  const latestUnit = unitFiltered.at(-1);
  const selectedSkill = {
    id: skillId,
    label: skillId === "all" ? category : skillId,
  };
  const unitTrendTargetCount = new Set(unitTrend.map((point) => point.scope)).size;
  const unitTargetSummaries = availableTargetEnvironments.flatMap((targetId) => {
    const targetRuns = unitSource
      .filter(
        (point) =>
          inRange(point.startedAt) &&
          point.category === category &&
          point.skillId === skillId &&
          (environment === "all" || point.environment === environment) &&
          point.targetEnvironment === targetId,
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const latestPoint = targetRuns.at(-1);
    if (!latestPoint) return [];
    const previousPoint = targetRuns.at(-2);
    return [
      {
        targetId,
        latest: latestPoint,
        runCount: targetRuns.length,
        passDelta: previousPoint
          ? latestPoint.passRatePct - previousPoint.passRatePct
          : null,
      },
    ];
  });
  const selectedUnitTarget =
    targetEnvironments.length === 1 ? targetEnvironments[0] : "all";
  const matrixTargets =
    selectedUnitTarget === "all"
      ? availableTargetEnvironments
      : availableTargetEnvironments.filter(
          (targetId) => targetId === selectedUnitTarget,
        );
  const matrixLatestByScope = new Map<
    string,
    (typeof unitSource)[number]
  >();
  unitSource
    .filter(
      (point) =>
        inRange(point.startedAt) &&
        point.category === category &&
        (environment === "all" || point.environment === environment) &&
        matrixTargets.includes(point.targetEnvironment),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .forEach((point) => {
      matrixLatestByScope.set(
        `${point.skillId}::${point.targetEnvironment}`,
        point,
      );
    });
  const matrixLatestPoints = Array.from(matrixLatestByScope.values());
  const matrixCombinationCount = skills.length * matrixTargets.length;
  const matrixPassingCount = matrixLatestPoints.filter((point) =>
    ["passed", "xpassed"].includes(point.verdict),
  ).length;
  const matrixCaseCount = matrixLatestPoints.reduce(
    (total, point) => total + point.totalCases,
    0,
  );
  const matrixPassRate = matrixCaseCount
    ? matrixLatestPoints.reduce(
        (total, point) =>
          total + point.passRatePct * point.totalCases,
        0,
      ) / matrixCaseCount
    : 0;
  const showUnitMatrix = historyType === "unit" && skillId === "all";
  const latestByTarget = stageTargets
    .map((targetId) =>
      e2eStageInRange
        .filter((point) => point.target === targetId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .at(-1),
    )
    .filter((point): point is NonNullable<typeof point> => point !== undefined);
  const isBatchRollup = historyType === "e2e" && target === "all";

  const openHistoryRun = (runId: string) => {
    if (!isBatchRollup && openingRunId !== runId) onOpenRun(runId, historyType);
  };

  return (
    <>
      <div className="page-heading history-heading">
        <div>
          <span className="eyebrow">Longitudinal quality</span>
          <h1>Evaluation history</h1>
          <p>
            Track the same E2E target or unit skill across runs without mixing
            their scopes.
          </p>
        </div>
        <div className="type-switch">
          <button
            className={historyType === "e2e" ? "active" : ""}
            onClick={() => setHistoryType("e2e")}
          >
            E2E history
          </button>
          <button
            className={historyType === "unit" ? "active" : ""}
            onClick={() => setHistoryType("unit")}
          >
            Unit skill history
          </button>
        </div>
      </div>
      <section
        className={`panel history-controls ${historyType === "unit" ? "history-controls--unit" : ""}`}
      >
        <div className="history-control-copy">
          <TypeBadge type={historyType} />
          <div>
            <strong>
              {historyType === "e2e"
                ? "Target-scoped history"
                : "Skill-scoped history"}
            </strong>
            <small>
              {historyType === "e2e"
                ? "Stage rollups are case-weighted across fan-out targets."
                : "Every unit run belongs to exactly one skill and one skill version."}
            </small>
          </div>
        </div>
        {historyType === "e2e" ? (
          <>
            <label>
              <span>Stage</span>
              <select
                aria-label="History stage"
                value={stage}
                onChange={(event) => {
                  setStage(event.target.value);
                  setTarget("all");
                }}
              >
                {stages.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Target</span>
              <select
                aria-label="History target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="all">All targets · stage rollup</option>
                {stageTargets.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              <span>Category</span>
              <select
                aria-label="History category"
                value={category}
                onChange={(event) => {
                  const nextCategory = event.target.value;
                  setCategory(nextCategory);
                  setSkillId("all");
                  setEnvironment("all");
                  setTargetEnvironments([]);
                }}
              >
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Skill</span>
              <select
                aria-label="History skill"
                value={skillId}
                onChange={(event) => {
                  setSkillId(event.target.value);
                  setEnvironment("all");
                  setTargetEnvironments([]);
                }}
              >
                <option value="all">All skills · category matrix</option>
                {skills.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target environment</span>
              <select
                aria-label="History target environment"
                value={selectedUnitTarget}
                onChange={(event) =>
                  setTargetEnvironments(
                    event.target.value === "all" ? [] : [event.target.value],
                  )
                }
              >
                <option value="all">All targets</option>
                {availableTargetEnvironments.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Environment</span>
              <select
                aria-label="History environment"
                value={environment}
                onChange={(event) => {
                  setEnvironment(event.target.value);
                  setTargetEnvironments([]);
                }}
              >
                <option value="all">All environments</option>
                {environments.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="range-switch">
          <button
            className={range === "7d" ? "active" : ""}
            onClick={() => setRange("7d")}
          >
            7d
          </button>
          <button
            className={range === "30d" ? "active" : ""}
            onClick={() => setRange("30d")}
          >
            30d
          </button>
          <button
            className={range === "90d" ? "active" : ""}
            onClick={() => setRange("90d")}
          >
            90d
          </button>
        </div>
      </section>
      {historyType === "unit" && (
        <nav className="unit-history-path" aria-label="Unit history scope">
          <button
            type="button"
            onClick={() => {
              setSkillId("all");
              setTargetEnvironments([]);
            }}
          >
            {category}
          </button>
          {skillId !== "all" && (
            <>
              <span>›</span>
              <button
                type="button"
                onClick={() => setTargetEnvironments([])}
              >
                {skillId}
              </button>
            </>
          )}
          {selectedUnitTarget !== "all" && (
            <>
              <span>›</span>
              <strong>{selectedUnitTarget}</strong>
            </>
          )}
        </nav>
      )}
      {!showUnitMatrix && <section className="history-metrics">
        <article className="panel">
          <span>Latest pass rate</span>
          <strong>{latest?.passRatePct.toFixed(1) ?? "—"}%</strong>
          <small className={passDelta >= 0 ? "delta-good" : "delta-bad"}>
            {passDelta >= 0 ? "+" : ""}
            {passDelta.toFixed(1)} points vs prior
          </small>
        </article>
        <article className="panel">
          <span>Latest mean score</span>
          <strong>
            {latest && latest.meanScoreRecorded !== false
              ? latest.meanScore.toFixed(2)
              : "—"}
          </strong>
          <small>out of 5.0</small>
        </article>
        <article className="panel">
          <span>Historical runs</span>
          <strong>{trend.length}</strong>
          <small>
            {historyType === "e2e" && target === "all"
              ? `${stageTargets.length} targets per batch`
              : "matching this scope"}
          </small>
        </article>
        <article className="panel">
          <span>Gate record</span>
          <strong>
            {trend.filter((point) => point.passRatePct >= 90).length}/
            {trend.length}
          </strong>
          <small>runs at or above 90%</small>
        </article>
        <article className="panel history-count history-count--passed">
          <span>Passed runs</span>
          <strong>{historyVerdicts.passed}</strong>
          <small>in the selected {rangeDays}-day window</small>
        </article>
        <article className="panel history-count history-count--failed">
          <span>Failed runs</span>
          <strong>{historyVerdicts.failed}</strong>
          <small>in the selected {rangeDays}-day window</small>
        </article>
        <article className="panel history-count history-count--blocked">
          <span>Blocked runs</span>
          <strong>{historyVerdicts.blocked}</strong>
          <small>in the selected {rangeDays}-day window</small>
        </article>
        <article className="panel history-count history-count--xpassed">
          <span>XPASS runs</span>
          <strong>{historyVerdicts.xpassed}</strong>
          <small>unexpected passes requiring review</small>
        </article>
      </section>}
      {!showUnitMatrix && (trend.length ? (
        historyType === "unit" && unitTrendTargetCount > 1 ? (
          <TargetComparisonChart
            points={trend}
            title={`${selectedSkill.label} · target comparison`}
            windowDays={rangeDays}
            windowEnd={referenceTime}
          />
        ) : (
          <HistoryChart
            points={trend}
            title={
              historyType === "e2e"
                ? target === "all"
                  ? `${stage} · stage rollup`
                  : target
                : `${selectedSkill.label} · ${trend[0]?.scope ?? "history"}`
            }
            windowDays={rangeDays}
            windowEnd={referenceTime}
            showPercentLabels={showPercentLabels}
            onShowPercentLabelsChange={setShowPercentLabels}
          />
        )
      ) : (
        <section className="panel empty">
          <strong>
            No historical runs in the selected {rangeDays}-day window
          </strong>
          <span>Change the time window, environment or scope selection.</span>
        </section>
      ))}
      {historyType === "e2e" ? (
        <section className="target-history-grid">
          {latestByTarget.map((point) => (
            <button
              key={point.target}
              className={`panel target-history-card ${target === point.target ? "selected" : ""}`}
              onClick={() => setTarget(point.target)}
            >
              <div>
                <span className="target-dot" />
                <strong>{point.target}</strong>
              </div>
              <b>{point.passRatePct.toFixed(1)}%</b>
              <small>
                {
                  e2eStageInRange.filter((item) => item.target === point.target)
                    .length
                }{" "}
                runs in {rangeDays}d · latest {formatDateShort(point.startedAt)}
              </small>
              <i>
                <em style={{ width: `${point.passRatePct}%` }} />
              </i>
            </button>
          ))}
        </section>
      ) : (
        <>
          {showUnitMatrix && (
            <>
              <section className="unit-health-metrics">
                <article className="panel">
                  <span>Overall status</span>
                  <strong
                    className={
                      matrixPassingCount === matrixCombinationCount &&
                      matrixCombinationCount > 0
                        ? "matrix-status-good"
                        : "matrix-status-attention"
                    }
                  >
                    {matrixPassingCount === matrixCombinationCount &&
                    matrixCombinationCount > 0
                      ? "Healthy"
                      : "Needs attention"}
                  </strong>
                  <small>Latest run in every visible combination</small>
                </article>
                <article className="panel">
                  <span>Healthy combinations</span>
                  <strong>
                    {matrixPassingCount}/{matrixCombinationCount}
                  </strong>
                  <small>skill × target combinations</small>
                </article>
                <article className="panel">
                  <span>Skills and targets</span>
                  <strong>
                    {skills.length} × {matrixTargets.length}
                  </strong>
                  <small>{matrixLatestPoints.length} combinations recorded</small>
                </article>
                <article className="panel">
                  <span>Observed pass rate</span>
                  <strong>{matrixPassRate.toFixed(1)}%</strong>
                  <small>case-weighted across latest runs</small>
                </article>
              </section>
              <section className="panel unit-health-matrix-panel">
                <div className="panel-heading unit-health-matrix-heading">
                  <div>
                    <h2>
                      {category}
                      {selectedUnitTarget === "all"
                        ? " · health matrix"
                        : ` · ${selectedUnitTarget}`}
                    </h2>
                    <p>
                      Select a skill, a target heading, or an individual cell
                      to move into a narrower history view.
                    </p>
                  </div>
                  <span className="result-count">
                    Latest in {rangeDays}d
                  </span>
                </div>
                {skills.length > 0 && matrixTargets.length > 0 ? (
                  <div className="unit-health-matrix-wrap">
                    <table className="unit-health-matrix">
                      <thead>
                        <tr>
                          <th>
                            <span className="unit-health-skill-column-heading">
                              Skill
                            </span>
                          </th>
                          {matrixTargets.map((targetId) => (
                            <th key={targetId}>
                              <button
                                type="button"
                                className="unit-health-axis-button unit-health-axis-button--target"
                                onClick={() =>
                                  setTargetEnvironments([targetId])
                                }
                              >
                                <strong>{targetId}</strong>
                                <small>View all skills →</small>
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {skills.map((matrixSkillId) => (
                          <tr key={matrixSkillId}>
                            <th scope="row">
                              <button
                                type="button"
                                className="unit-health-axis-button unit-health-axis-button--skill"
                                onClick={() => {
                                  setSkillId(matrixSkillId);
                                  setTargetEnvironments([]);
                                }}
                              >
                                <strong>{matrixSkillId}</strong>
                                <small>View all targets →</small>
                              </button>
                            </th>
                            {matrixTargets.map((targetId) => {
                              const point = matrixLatestByScope.get(
                                `${matrixSkillId}::${targetId}`,
                              );
                              const state = point
                                ? point.verdict === "passed" ||
                                  point.verdict === "xpassed"
                                  ? "passing"
                                  : point.verdict === "blocked"
                                    ? "blocked"
                                    : "failing"
                                : "empty";
                              return (
                                <td key={targetId}>
                                  <button
                                    type="button"
                                    className={`unit-health-cell ${state}`}
                                    disabled={!point}
                                    aria-label={
                                      point
                                        ? `${matrixSkillId}, ${targetId}, ${point.passRatePct.toFixed(1)} percent, ${point.verdict}`
                                        : `${matrixSkillId}, ${targetId}, no run recorded`
                                    }
                                    onClick={() => {
                                      setSkillId(matrixSkillId);
                                      setTargetEnvironments([targetId]);
                                    }}
                                  >
                                    {point ? (
                                      <>
                                        <strong>
                                          {point.passRatePct.toFixed(1)}%
                                        </strong>
                                        <span>
                                          {point.meanScoreRecorded
                                            ? `Mean ${point.meanScore.toFixed(2)}`
                                            : "Mean not recorded"}
                                        </span>
                                        <small>
                                          {point.verdict} ·{" "}
                                          {formatDateShort(point.startedAt)}
                                        </small>
                                      </>
                                    ) : (
                                      <>
                                        <strong>—</strong>
                                        <span>No coverage</span>
                                      </>
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty unit-health-empty">
                    <strong>No matrix data in this window</strong>
                    <span>Change the time window or environment.</span>
                  </div>
                )}
              </section>
            </>
          )}
          {!showUnitMatrix && (
            <>
              {unitTargetSummaries.length > 0 && (
                <section className="unit-target-summary-grid">
                  {unitTargetSummaries.map((summary) => {
                    const isolated =
                      targetEnvironments.length === 1 &&
                      targetEnvironments[0] === summary.targetId;
                    return (
                      <button
                        key={summary.targetId}
                        type="button"
                        className={`panel unit-target-summary-card ${isolated ? "selected" : ""}`}
                        aria-pressed={isolated}
                        onClick={() =>
                          setTargetEnvironments(
                            isolated ? [] : [summary.targetId],
                          )
                        }
                      >
                        <div className="unit-target-summary-title">
                          <span
                            className={`target-dot target-dot--${summary.latest.verdict}`}
                            aria-label={`Latest verdict: ${summary.latest.verdict}`}
                          />
                          <div>
                            <strong>{summary.targetId}</strong>
                            <small>
                              {summary.runCount} run
                              {summary.runCount === 1 ? "" : "s"} in {rangeDays}d
                            </small>
                          </div>
                        </div>
                        <div className="unit-target-summary-metrics">
                          <span>
                            <small>Pass rate</small>
                            <strong>
                              {summary.latest.passRatePct.toFixed(1)}%
                            </strong>
                          </span>
                          <span>
                            <small>Mean score</small>
                            <strong>
                              {summary.latest.meanScoreRecorded
                                ? summary.latest.meanScore.toFixed(2)
                                : "—"}
                            </strong>
                          </span>
                          <span>
                            <small>Change</small>
                            <strong
                              className={
                                summary.passDelta === null ||
                                summary.passDelta >= 0
                                  ? "delta-good"
                                  : "delta-bad"
                              }
                            >
                              {summary.passDelta === null
                                ? "—"
                                : `${summary.passDelta >= 0 ? "+" : ""}${summary.passDelta.toFixed(1)} pts`}
                            </strong>
                          </span>
                        </div>
                        <div className="unit-target-summary-meta">
                          <span>
                            {summary.latest.gitRef ??
                              `skill v${summary.latest.skillVersion}`}
                          </span>
                          <span>{formatDateShort(summary.latest.startedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </section>
              )}
              <section className="panel unit-history-summary">
                <div>
                  <span className="collection-icon case">S</span>
                  <div>
                    <strong>{selectedSkill.label}</strong>
                    <small>{selectedSkill.id}</small>
                  </div>
                </div>
                <div>
                  <span>Category</span>
                  <strong>{category}</strong>
                </div>
                <div>
                  <span>Target scope</span>
                  <strong>
                    {targetEnvironments.length === 0
                      ? `${availableTargetEnvironments.length} targets`
                      : targetEnvironments.join(", ")}
                  </strong>
                </div>
                <div>
                  <span>Latest agent</span>
                  <strong>
                    {latestUnit?.agentName ?? "Agent not recorded"}
                  </strong>
                </div>
              </section>
            </>
          )}
        </>
      )}
      <section className="panel history-table">
        <div className="panel-heading">
          <div>
            <h2>
              {isBatchRollup
                ? "Scheduled batch history"
                : "Matching run history"}
            </h2>
            <p>
              {isBatchRollup
                ? "One rollup row per multi-target workflow execution · select a target above to open individual runs"
                : "Every execution for the selected scope · select a row to open its live run details"}
            </p>
          </div>
          <span className="result-count">{trend.length} results</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isBatchRollup ? "Batch" : "Run"}</th>
                <th>Scope</th>
                <th>Verdict</th>
                <th>Pass rate</th>
                <th>Mean score</th>
                <th>Cases</th>
                <th>Duration</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((point) => (
                <tr
                  key={point.id}
                  className={isBatchRollup ? undefined : "clickable-row"}
                  tabIndex={isBatchRollup ? undefined : 0}
                  aria-label={
                    isBatchRollup ? undefined : `Open run ${point.id}`
                  }
                  onClick={
                    isBatchRollup ? undefined : () => openHistoryRun(point.id)
                  }
                  onKeyDown={
                    isBatchRollup
                      ? undefined
                      : (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openHistoryRun(point.id);
                          }
                        }
                  }
                >
                  <td>
                    {isBatchRollup ? (
                      <span className="run-link">{point.id}</span>
                    ) : (
                      <button
                        className="run-link"
                        disabled={openingRunId === point.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          openHistoryRun(point.id);
                        }}
                      >
                        {openingRunId === point.id ? "Opening…" : point.id}
                      </button>
                    )}
                    {(point.githubRunId || point.gitSha) && (
                      <small className="history-git-meta">
                        {point.githubRunId && point.githubRunUrl ? (
                          <a
                            href={point.githubRunUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            GitHub run {point.githubRunId} ↗
                          </a>
                        ) : point.githubRunId ? (
                          <span>GitHub run {point.githubRunId}</span>
                        ) : null}
                        {point.gitSha && (
                          <span title={point.gitSha}>
                            SHA {shortGitSha(point.gitSha)}
                          </span>
                        )}
                      </small>
                    )}
                  </td>
                  <td>
                    {point.scope}
                    {historyType === "unit" && (
                      <small className="history-scope-meta">
                        {point.skillVersion}
                        {point.agentName ? ` · ${point.agentName}` : ""}
                      </small>
                    )}
                  </td>
                  <td>
                    <StatusBadge verdict={point.verdict} />
                  </td>
                  <td>
                    <strong>{point.passRatePct.toFixed(1)}%</strong>
                  </td>
                  <td>
                    {point.meanScoreRecorded === false
                      ? "—"
                      : point.meanScore.toFixed(2)}
                  </td>
                  <td>{point.totalCases}</td>
                  <td>{formatDuration(point.durationMs)}</td>
                  <td>{formatTime(point.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function CompareView({
  runs,
  api,
  onError,
}: {
  runs: EvalRun[];
  api: EvalApi | null;
  onError: (message: string | null) => void;
}) {
  const [compareType, setCompareType] = useState<EvalType>("e2e");
  return (
    <>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">Regression analysis</span>
          <h1>Compare evaluation runs</h1>
          <p>
            Compare like with like: E2E targets and unit skill runs use separate
            baselines.
          </p>
        </div>
        <div className="type-switch">
          <button
            className={compareType === "e2e" ? "active" : ""}
            onClick={() => setCompareType("e2e")}
          >
            E2E targets
          </button>
          <button
            className={compareType === "unit" ? "active" : ""}
            onClick={() => setCompareType("unit")}
          >
            Unit skills
          </button>
        </div>
      </div>
      <TypeComparison
        key={compareType}
        runs={runs}
        type={compareType}
        api={api}
        onError={onError}
      />
    </>
  );
}

function TypeComparison({
  runs,
  type,
  api,
  onError,
}: {
  runs: EvalRun[];
  type: EvalType;
  api: EvalApi | null;
  onError: (message: string | null) => void;
}) {
  return type === "unit" ? (
    <UnitRunComparison runs={runs} api={api} onError={onError} />
  ) : (
    <E2ERunComparison runs={runs} api={api} onError={onError} />
  );
}

function E2ERunComparison({
  runs,
  api,
  onError,
}: {
  runs: EvalRun[];
  api: EvalApi | null;
  onError: (message: string | null) => void;
}) {
  const e2eRuns = runs
    .filter(
      (run) => run.executionStatus === "completed" && run.evalType === "e2e",
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const scopes = Array.from(
    new Set(e2eRuns.map((run) => `${run.stage}::${run.target}`)),
  );
  const [scope, setScope] = useState(scopes[0] ?? "");
  const comparable = e2eRuns.filter(
    (run) => `${run.stage}::${run.target}` === scope,
  );
  if (!e2eRuns.length)
    return (
      <section className="panel empty">
        <strong>No completed E2E runs</strong>
        <span>Load at least one completed target run before comparing.</span>
      </section>
    );
  return (
    <>
      <section className="panel compare-scope">
        <label>
          <span>E2E target scope</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            {scopes.map((value) => {
              const [stage, target] = value.split("::");
              return (
                <option key={value} value={value}>
                  {target} · {stage}
                </option>
              );
            })}
          </select>
        </label>
        <div>
          <strong>Target-isolated comparison</strong>
          <small>
            Only runs for this exact stage and target are available below.
          </small>
        </div>
      </section>
      <RunPairPicker
        key={scope}
        comparable={comparable}
        unitRuns={false}
        api={api}
        onError={onError}
      />
    </>
  );
}

function UnitRunComparison({
  runs,
  api,
  onError,
}: {
  runs: EvalRun[];
  api: EvalApi | null;
  onError: (message: string | null) => void;
}) {
  const unitRuns = runs.filter(
    (run) => run.executionStatus === "completed" && run.evalType === "unit",
  );
  const skills = Array.from(
    new Set(
      unitRuns
        .map((run) => run.unitConfig?.skillId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [skillId, setSkillId] = useState(skills[0] ?? "");
  const comparable = unitRuns
    .filter((run) => run.unitConfig?.skillId === skillId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <>
      <section className="panel compare-scope">
        <label>
          <span>Unit skill</span>
          <select
            value={skillId}
            onChange={(event) => setSkillId(event.target.value)}
          >
            {skills.map((skill) => (
              <option key={skill}>{skill}</option>
            ))}
          </select>
        </label>
        <div>
          <strong>Run comparison</strong>
          <small>
            Defaults to the latest run versus the previous run, even when both
            use the same skill version.
          </small>
        </div>
      </section>
      {comparable.length ? (
        <RunPairPicker
          key={skillId}
          comparable={comparable}
          unitRuns
          api={api}
          onError={onError}
        />
      ) : (
        <section className="panel empty">
          <strong>No completed runs</strong>
          <span>
            {skillId || "This skill"} has no completed unit runs to compare.
          </span>
        </section>
      )}
    </>
  );
}

function RunPairPicker({
  comparable,
  unitRuns,
  api,
  onError,
}: {
  comparable: EvalRun[];
  unitRuns: boolean;
  api: EvalApi | null;
  onError: (message: string | null) => void;
}) {
  const defaultCandidate = comparable[0];
  const defaultBaseline = comparable[1] ?? comparable[0];
  const [baselineId, setBaselineId] = useState(defaultBaseline.runId);
  const [candidateId, setCandidateId] = useState(defaultCandidate.runId);
  const [caseSets, setCaseSets] = useState<Record<string, EvalCase[]>>({});
  const [loadingCases, setLoadingCases] = useState(true);
  const baseline = comparable.find((run) => run.runId === baselineId)!;
  const candidate = comparable.find((run) => run.runId === candidateId)!;
  const optionLabel = (run: EvalRun) =>
    unitRuns
      ? `v${run.unitConfig?.skillVersion} · ${run.runId} · ${formatTime(run.startedAt)} · SHA ${shortGitSha(run.gitSha)} · ${run.summary.passRatePct}%`
      : `${run.runId} · ${formatTime(run.startedAt)} · SHA ${shortGitSha(run.gitSha)} · ${run.summary.passRatePct}%`;
  useEffect(() => {
    const controller = new AbortController();
    const selected =
      baseline.runId === candidate.runId ? [baseline] : [baseline, candidate];
    void Promise.all(
      selected.map(async (run) => {
        if (!api)
          throw new Error(
            "Eval API is not configured. Comparison cases are unavailable.",
          );
        const items = await api.listCases(run, controller.signal);
        return [
          run.runId,
          items.filter((item) => item.runId === run.runId),
        ] as const;
      }),
    )
      .then((entries) => {
        if (!controller.signal.aborted) {
          setCaseSets((current) => ({
            ...current,
            ...Object.fromEntries(entries),
          }));
          onError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          onError(
            error instanceof Error
              ? error.message
              : "Unable to load comparison cases",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCases(false);
      });
    return () => controller.abort();
  }, [api, baseline, candidate, onError]);
  const baselineCases = caseSets[baseline.runId] ?? [];
  const candidateCases = caseSets[candidate.runId] ?? [];
  const hasUnitMetrics =
    !unitRuns ||
    (baselineCases.some(
      (item) => item.scores && Object.keys(item.scores).length,
    ) &&
      candidateCases.some(
        (item) => item.scores && Object.keys(item.scores).length,
      ));
  const baselineSuites = hasUnitMetrics
    ? summarizeCases(baseline, baselineCases)
    : baseline.suites;
  const candidateSuites = hasUnitMetrics
    ? summarizeCases(candidate, candidateCases)
    : candidate.suites;
  return (
    <>
      <section className="panel compare-picker">
        <label>
          <span>Baseline run</span>
          <select
            value={baselineId}
            onChange={(event) => {
              setLoadingCases(true);
              onError(null);
              setBaselineId(event.target.value);
            }}
          >
            {comparable.map((run) => (
              <option key={run.runId} value={run.runId}>
                {optionLabel(run)}
              </option>
            ))}
          </select>
        </label>
        <span className="compare-arrow">→</span>
        <label>
          <span>Candidate run</span>
          <select
            value={candidateId}
            onChange={(event) => {
              setLoadingCases(true);
              onError(null);
              setCandidateId(event.target.value);
            }}
          >
            {comparable.map((run) => (
              <option key={run.runId} value={run.runId}>
                {optionLabel(run)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {loadingCases ? (
        <section className="panel compare-loading">
          <span />
          <span />
          <span /> Loading case-level comparison…
        </section>
      ) : (
        <ComparisonResults
          baseline={baseline}
          candidate={candidate}
          unitRuns={unitRuns}
          baselineSuites={baselineSuites}
          candidateSuites={candidateSuites}
        />
      )}
    </>
  );
}

function ComparisonResults({
  baseline,
  candidate,
  unitRuns,
  baselineSuites,
  candidateSuites,
}: {
  baseline: EvalRun;
  candidate: EvalRun;
  unitRuns: boolean;
  baselineSuites: SuiteSummary[];
  candidateSuites: SuiteSummary[];
}) {
  const passDelta =
    candidate.summary.passRatePct - baseline.summary.passRatePct;
  const scoreDelta = candidate.summary.meanScore - baseline.summary.meanScore;
  const durationDelta =
    (candidate.durationMs ?? 0) - (baseline.durationMs ?? 0);
  const suites = Array.from(
    new Set([
      ...baselineSuites.map((suite) => suite.name),
      ...candidateSuites.map((suite) => suite.name),
    ]),
  );
  return (
    <>
      <section className="delta-grid">
        <DeltaCard
          label="Pass rate"
          value={`${passDelta >= 0 ? "+" : ""}${passDelta.toFixed(1)}%`}
          good={passDelta >= 0}
          detail={`${baseline.summary.passRatePct}% → ${candidate.summary.passRatePct}%`}
        />
        <DeltaCard
          label="Mean score"
          value={`${scoreDelta >= 0 ? "+" : ""}${scoreDelta.toFixed(2)}`}
          good={scoreDelta >= 0}
          detail={`${baseline.summary.meanScore} → ${candidate.summary.meanScore}`}
        />
        <DeltaCard
          label="Duration"
          value={`${durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(durationDelta))}`}
          good={durationDelta <= 0}
          detail={`${formatDuration(baseline.durationMs)} → ${formatDuration(candidate.durationMs)}`}
        />
        <DeltaCard
          label="Failed cases"
          value={`${candidate.summary.failed - baseline.summary.failed >= 0 ? "+" : ""}${candidate.summary.failed - baseline.summary.failed}`}
          good={candidate.summary.failed <= baseline.summary.failed}
          detail={`${baseline.summary.failed} → ${candidate.summary.failed}`}
        />
      </section>
      <section className="panel compare-table">
        <div className="panel-heading">
          <div>
            <h2>{unitRuns ? "Unit metric changes" : "Suite changes"}</h2>
            <p>
              {unitRuns
                ? `v${baseline.unitConfig?.skillVersion} (${baseline.runId}, SHA ${shortGitSha(baseline.gitSha)}) → v${candidate.unitConfig?.skillVersion} (${candidate.runId}, SHA ${shortGitSha(candidate.gitSha)})`
                : `${baseline.runId} (SHA ${shortGitSha(baseline.gitSha)}) → ${candidate.runId} (SHA ${shortGitSha(candidate.gitSha)})`}
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{unitRuns ? "Metric" : "Suite"}</th>
                <th>Baseline score</th>
                <th>Candidate score</th>
                <th>Delta</th>
                <th>Candidate result</th>
              </tr>
            </thead>
            <tbody>
              {suites.map((name) => {
                const before = baselineSuites.find(
                  (suite) => suite.name === name,
                );
                const after = candidateSuites.find(
                  (suite) => suite.name === name,
                );
                const delta =
                  (after?.meanScore ?? 0) - (before?.meanScore ?? 0);
                return (
                  <tr key={name}>
                    <td>
                      <strong>{name}</strong>
                    </td>
                    <td>{before?.total ? before.meanScore.toFixed(2) : "—"}</td>
                    <td>{after?.total ? after.meanScore.toFixed(2) : "—"}</td>
                    <td>
                      <span className={delta >= 0 ? "delta-good" : "delta-bad"}>
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(2)}
                      </span>
                    </td>
                    <td>
                      {after?.total
                        ? `${after.passed}/${after.total} passed`
                        : "Not run"}
                    </td>
                  </tr>
                );
              })}
              {!suites.length && (
                <tr>
                  <td colSpan={5}>
                    No case metrics were returned for these runs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function DeltaCard({
  label,
  value,
  good,
  detail,
}: {
  label: string;
  value: string;
  good: boolean;
  detail: string;
}) {
  return (
    <article className="panel delta-card">
      <span>{label}</span>
      <strong className={good ? "delta-good" : "delta-bad"}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function NewRunModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (run: EvalRun) => void;
}) {
  const [evalType, setEvalType] = useState<EvalType>("e2e");
  const [stage, setStage] = useState("1-dev-staging");
  const [target, setTarget] = useState("us-east4-dev-staging");
  const [selectedSuites, setSelectedSuites] = useState(
    e2eSuites.map((suite) => suite.id),
  );
  const [maxTier, setMaxTier] = useState<"all" | 1 | 2 | 3>("all");
  const [selectedSkills, setSelectedSkills] = useState(["feedback-skill"]);
  const [bsaEnvironment, setBsaEnvironment] = useState("staging");
  const [mode, setMode] = useState<"all" | "single-turn" | "multi-turn">("all");
  const [tags, setTags] = useState("");
  const toggle = (
    value: string,
    current: string[],
    setCurrent: (values: string[]) => void,
  ) =>
    setCurrent(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const now = new Date();
    const common = {
      runId: `${evalType}-${now.getUTCSeconds().toString(16)}${now.getUTCMilliseconds().toString(16)}c9f2a1`,
      evalType,
      executionStatus: "queued" as const,
      verdict: "pending" as const,
      startedAt: now.toISOString(),
      trigger: "ui" as const,
      actor: "artem.kovtunenko",
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        passRatePct: 0,
        meanScore: 0,
        p95ResponseTimeMs: 0,
      },
    };
    if (evalType === "e2e") {
      onCreate({
        ...common,
        evalType,
        stage,
        target,
        policyVersion: "gate-v4",
        datasetVersion: `e2e/${stage}/${target}/target.yaml`,
        e2eConfig: {
          kind: "live-target",
          targetId: target,
          selectedSuites,
          maxTier,
          passRateThreshold: 0.9,
        },
        suites: selectedSuites.map((name) => ({
          name,
          total: 0,
          passed: 0,
          failed: 0,
          meanScore: 0,
        })),
      });
    } else {
      const skillId = selectedSkills[0];
      onCreate({
        ...common,
        evalType,
        stage: bsaEnvironment,
        target: skillId,
        policyVersion: "unit-v2",
        datasetVersion: `${skillId}@next`,
        unitConfig: {
          kind: "skill-eval",
          skillId,
          skillVersion: "next",
          bsaEnvironment,
          bsaVersion: "current",
          mode,
          metrics: ["tool_use_quality", "general_quality"],
        },
        suites: [
          { name: skillId, total: 0, passed: 0, failed: 0, meanScore: 0 },
        ],
      });
    }
  };
  const canSubmit =
    evalType === "e2e" ? selectedSuites.length > 0 : selectedSkills.length > 0;
  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Start a new evaluation run"
    >
      <button
        className="modal-backdrop"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <form className="new-run-modal" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow">Execution request</span>
            <h2>Start evaluation run</h2>
            <p>
              Choose the workflow first; E2E and unit runs intentionally use
              different inputs.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">
          <fieldset>
            <legend>Evaluation workflow</legend>
            <label className={evalType === "e2e" ? "selected" : ""}>
              <input
                type="radio"
                name="type"
                value="e2e"
                checked={evalType === "e2e"}
                onChange={() => setEvalType("e2e")}
              />
              <span>
                <strong>End-to-end</strong>
                <small>Live conversations against one deployed target</small>
              </span>
            </label>
            <label className={evalType === "unit" ? "selected" : ""}>
              <input
                type="radio"
                name="type"
                value="unit"
                checked={evalType === "unit"}
                onChange={() => setEvalType("unit")}
              />
              <span>
                <strong>Unit / skill</strong>
                <small>One mock-backed skill evaluation per run</small>
              </span>
            </label>
          </fieldset>
          {evalType === "e2e" ? (
            <section
              className="workflow-form"
              aria-label="E2E run configuration"
            >
              <div className="workflow-banner e2e">
                <span>◎</span>
                <div>
                  <strong>Target-first live run</strong>
                  <p>
                    The target manifest defines the deployed environment,
                    credentials, roles and available suites. No tool mocking.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>Stage</span>
                  <select
                    value={stage}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStage(value);
                      setTarget(
                        value === "1-dev-staging"
                          ? "us-east4-dev-staging"
                          : "us-east4-prod-staging",
                      );
                    }}
                  >
                    <option>1-dev-staging</option>
                    <option>2-prod-staging</option>
                  </select>
                </label>
                <label>
                  <span>Deployed target</span>
                  <select
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    {stage === "1-dev-staging" ? (
                      <option>us-east4-dev-staging</option>
                    ) : (
                      <option>us-east4-prod-staging</option>
                    )}
                  </select>
                </label>
                <label className="wide">
                  <span>Conversation depth</span>
                  <select
                    value={maxTier}
                    onChange={(event) =>
                      setMaxTier(
                        event.target.value === "all"
                          ? "all"
                          : (Number(event.target.value) as 1 | 2 | 3),
                      )
                    }
                  >
                    <option value="all">All tiers enabled by target</option>
                    <option value="1">Tier 1 only</option>
                    <option value="2">Up to tier 2</option>
                    <option value="3">Up to tier 3</option>
                  </select>
                </label>
              </div>
              <div className="selection-heading">
                <div>
                  <strong>Suites / skills to exercise</strong>
                  <small>
                    Subset of suites already enabled for this target
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSuites(
                      selectedSuites.length === e2eSuites.length
                        ? []
                        : e2eSuites.map((suite) => suite.id),
                    )
                  }
                >
                  {selectedSuites.length === e2eSuites.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              <div className="check-list">
                {e2eSuites.map((suite) => (
                  <label
                    key={suite.id}
                    className={
                      selectedSuites.includes(suite.id) ? "checked" : ""
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuites.includes(suite.id)}
                      onChange={() =>
                        toggle(suite.id, selectedSuites, setSelectedSuites)
                      }
                    />
                    <span>
                      <strong>{suite.label}</strong>
                      <small>{suite.note}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="target-summary">
                <span>Target manifest</span>
                <code>{`e2e/${stage}/${target}/target.yaml`}</code>
                <span>Roles</span>
                <strong>employee · manager</strong>
                <span>Judge</span>
                <strong>LLM-as-judge</strong>
              </div>
            </section>
          ) : (
            <section
              className="workflow-form"
              aria-label="Unit skill run configuration"
            >
              <div className="workflow-banner unit">
                <span>◇</span>
                <div>
                  <strong>Skill-first mock-backed run</strong>
                  <p>
                    Each skill brings its own evals.json, declared tools and
                    REST or MCP mock setup.
                  </p>
                </div>
              </div>
              <div className="selection-heading">
                <div>
                  <strong>Skills to evaluate</strong>
                  <small>
                    Select one skill or queue several independent skill
                    evaluations
                  </small>
                </div>
                <span>{selectedSkills.length} selected</span>
              </div>
              <div className="check-list skill-list">
                {unitSkills.map((skill) => (
                  <label
                    key={skill.id}
                    className={
                      selectedSkills.includes(skill.id) ? "checked" : ""
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(skill.id)}
                      onChange={() =>
                        toggle(skill.id, selectedSkills, setSelectedSkills)
                      }
                    />
                    <span>
                      <strong>{skill.label}</strong>
                      <small>{skill.id}</small>
                      <em>
                        {skill.tools.map((tool) => `◦ ${tool}`).join("  ")}
                      </em>
                    </span>
                  </label>
                ))}
              </div>
              <div className="form-grid unit-options">
                <label>
                  <span>BSA environment</span>
                  <select
                    value={bsaEnvironment}
                    onChange={(event) => setBsaEnvironment(event.target.value)}
                  >
                    <option value="staging">Staging BSA</option>
                    <option value="dev">Development BSA</option>
                    <option value="local">Local BSA</option>
                  </select>
                </label>
                <label>
                  <span>Conversation mode</span>
                  <select
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as typeof mode)
                    }
                  >
                    <option value="all">All test modes</option>
                    <option value="single-turn">Single-turn only</option>
                    <option value="multi-turn">Multi-turn only</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Optional tags</span>
                  <input
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="smoke, tool-calling"
                  />
                </label>
              </div>
              <div className="scoring-preview">
                <div>
                  <span>Deterministic</span>
                  <strong>tool_use_quality</strong>
                  <small>Expected tool calls and parameter matching</small>
                </div>
                <div>
                  <span>LLM judge</span>
                  <strong>general_quality</strong>
                  <small>Response measured against the case reference</small>
                </div>
                <p>
                  <strong>Gate:</strong> every computed metric must clear its
                  threshold; overall run pass rate must be at least 90%.
                </p>
              </div>
            </section>
          )}
          <div className="queue-note">
            <span>↗</span>
            <div>
              <strong>Asynchronous execution</strong>
              <p>
                The API validates this type-specific payload, returns a run ID
                and publishes work to the Python evaluator.
              </p>
            </div>
          </div>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!canSubmit}
          >
            Queue{" "}
            {evalType === "e2e" ? "live E2E" : `${selectedSkills.length} skill`}{" "}
            evaluation
            {evalType === "unit" && selectedSkills.length !== 1 ? "s" : ""}
          </button>
        </footer>
      </form>
    </div>
  );
}

void NewRunModal;
