import type { HistoryBranch, HistoryRun } from "./unit-history-types";
import type { FixedTimeWindow } from "./time-window";

export type HistoryTrendMetric = "passRate" | "duration" | "cases" | "failed";
export const HISTORY_TREND_METRICS: Record<
  HistoryTrendMetric,
  {
    label: string;
    axis: string;
    unit: string;
    deltaUnit: string;
    /** Which direction is an improvement; null when neither is. */
    better: "higher" | "lower" | null;
  }
> = {
  passRate: {
    label: "Pass rate",
    axis: "Pass rate (%)",
    unit: "%",
    deltaUnit: " pp",
    better: "higher",
  },
  failed: {
    label: "Failed tests",
    axis: "Failed tests",
    unit: " failed",
    deltaUnit: " failed",
    better: "lower",
  },
  cases: {
    label: "Tests evaluated",
    axis: "Tests evaluated",
    unit: " tests",
    deltaUnit: " tests",
    better: null,
  },
  duration: {
    label: "Execution duration",
    axis: "Execution duration (seconds)",
    unit: "s",
    deltaUnit: " s",
    better: "lower",
  },
};
export interface HistoryTrendPoint {
  run: HistoryRun;
  value: number;
}
export interface HistoryTrendSeries {
  branchKey: string;
  label: string;
  points: HistoryTrendPoint[];
  segments: HistoryTrendPoint[][];
}

export function historyTrendValue(
  run: HistoryRun,
  metric: HistoryTrendMetric,
): number | null {
  if (run.qualityMeasured !== true) return null;
  const value =
    metric === "passRate"
      ? run.passRatePct
      : metric === "duration"
        ? run.durationMs
        : metric === "cases"
          ? run.total
          : run.total != null && run.passed != null
            ? run.total - run.passed
            : null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  if (metric === "passRate" && value > 100) return null;
  return metric === "duration" ? value / 1000 : value;
}

export function historyTrendSeries(
  runs: HistoryRun[],
  branches: HistoryBranch[],
  window: FixedTimeWindow,
  metric: HistoryTrendMetric,
  selectedCohortKey: string | null,
): HistoryTrendSeries[] {
  const start = Date.parse(window.startedFrom),
    end = Date.parse(window.startedBefore);
  const grouped = new Map<string, HistoryRun[]>();
  // The API returns newest first. Reverse before the stable time sort to preserve tie order.
  [...runs]
    .reverse()
    .filter((run) => {
      const at = Date.parse(run.startedAt);
      return (
        run.executionStatus === "completed" &&
        at >= start &&
        at < end &&
        (!selectedCohortKey || run.cohortKey === selectedCohortKey)
      );
    })
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .forEach((run) => {
      const list = grouped.get(run.branchKey) ?? [];
      list.push(run);
      grouped.set(run.branchKey, list);
    });
  return branches.flatMap((branch) => {
    const points: HistoryTrendPoint[] = [],
      segments: HistoryTrendPoint[][] = [];
    let current: HistoryTrendPoint[] = [],
      signature: string | null = null;
    const finish = () => {
      if (current.length) segments.push(current);
      current = [];
    };
    for (const run of grouped.get(branch.key) ?? []) {
      const value = historyTrendValue(run, metric);
      if (value === null) {
        finish();
        signature = null;
        continue;
      }
      // A recorded case-set identity is required to join runs. Never guess from case count.
      const nextSignature =
        run.caseSetKey && run.branchLabel !== "Branch not recorded"
          ? JSON.stringify([run.cohortKey, run.caseSetKey])
          : null;
      if (!nextSignature || nextSignature !== signature) finish();
      const point = { run, value };
      points.push(point);
      current.push(point);
      signature = nextSignature;
      if (!signature) finish();
    }
    finish();
    return points.length
      ? [{ branchKey: branch.key, label: branch.label, points, segments }]
      : [];
  });
}

export function isOperationalHistoryRun(run: HistoryRun): boolean {
  return (
    ["error", "blocked"].includes(run.executionStatus) ||
    ["error", "blocked"].includes(run.verdict) ||
    (run.blockedCases ?? 0) > 0
  );
}

export function historyTrendCeiling(
  series: HistoryTrendSeries[],
  metric: HistoryTrendMetric,
): number {
  if (metric === "passRate") return 100;
  const maximum = series.reduce(
    (highest, branch) =>
      branch.points.reduce(
        (value, point) => Math.max(value, point.value),
        highest,
      ),
    0,
  );
  if (!maximum) return 1;
  const scale = 10 ** Math.floor(Math.log10(maximum));
  const step = [1, 2, 5, 10].find((factor) => factor * scale >= maximum) ?? 10;
  return step * scale;
}

export function historyTrendConnections(
  series: HistoryTrendSeries,
  metric: HistoryTrendMetric,
  visibleSeries?: HistoryTrendSeries[],
) {
  const visiblePoints = visibleSeries
    ? new Map(
        visibleSeries.flatMap((branch) =>
          branch.points.map((point) => [point.run.runId, point] as const),
        ),
      )
    : null;
  return series.points.flatMap((point, index) => {
    const previous = visiblePoints
      ? visiblePoints.get(point.run.trendPreviousRunId ?? "")
      : series.points[index - 1];
    if (
      !previous ||
      point.run.trendPreviousRunId !== previous.run.runId ||
      !["comparable", "settings_changed"].includes(
        point.run.trendTransition ?? "",
      )
    )
      return [];
    const changed = point.run.trendTransition === "settings_changed";
    const delta = changed
      ? null
      : metric === "passRate"
        ? (point.run.trendPassRateDelta ?? null)
        : point.run.trendDurationDeltaMs == null
          ? null
          : point.run.trendDurationDeltaMs / 1000;
    const direction = changed
      ? "changed"
      : delta === null
        ? "unknown"
        : delta === 0
          ? "same"
          : (metric === "passRate" ? delta > 0 : delta < 0)
            ? "improved"
            : "regressed";
    return [{ previous, point, delta, direction }];
  });
}

/** Render only explicit server-provided chronology links whose endpoints are visible. */
export function historyContextConnections(series: HistoryTrendSeries[]) {
  const points = new Map(
    series.flatMap((branch) =>
      branch.points.map((point) => [point.run.runId, point] as const),
    ),
  );
  return [...points.values()].flatMap((point) => {
    const previous = points.get(point.run.trendContextPreviousRunId ?? "");
    if (!previous || !point.run.trendContextChanges?.length) return [];
    return [
      { previous, point, label: point.run.trendContextChanges.join(" · ") },
    ];
  });
}

export interface TrendReference {
  run: HistoryRun;
  passRateDelta: number | null;
  durationDeltaMs: number | null;
  /** Recorded differences only; missing metadata is never reported as a change. */
  changes: string[];
}
export interface TrendProgression {
  context: string;
  branch: string;
  previousSameBranch: TrendReference | null;
  previousBranch: TrendReference | null;
  branchStart: TrendReference;
}
export const trendBranch = (run: HistoryRun) =>
  run.sourceBranch ?? run.branchLabel;
export const trendContext = (run: HistoryRun) =>
  `${run.stage ?? "unknown"} · ${run.targetEnvironment ?? "Target not recorded"} · ${run.environment ?? "unknown"}`;
export function trendReference(
  run: HistoryRun,
  before: HistoryRun,
): TrendReference {
  const changes: string[] = [];
  for (const [title, now, then] of [
    ["Skill version", run.skillVersion, before.skillVersion],
    ["BSA version", run.bsaVersion, before.bsaVersion],
    ["Agent", run.agentName, before.agentName],
  ] as const) {
    if (now && then && now !== then) changes.push(`${title} ${then} → ${now}`);
  }
  if (run.total != null && before.total != null && run.total !== before.total)
    changes.push(`Tests ${before.total} → ${run.total}`);
  else if (
    run.caseSetKey &&
    before.caseSetKey &&
    run.caseSetKey !== before.caseSetKey
  )
    changes.push("Test definitions changed");
  return {
    run: before,
    passRateDelta:
      run.passRatePct != null && before.passRatePct != null
        ? run.passRatePct - before.passRatePct
        : null,
    durationDeltaMs:
      run.durationMs != null && before.durationMs != null
        ? run.durationMs - before.durationMs
        : null,
    changes,
  };
}
/**
 * Chronological progression per stage/target/environment. Branches are compared
 * regardless of skill/BSA version (those are reported as changes), and the
 * previous branch is its final run before this branch started in the context.
 */
export function historyProgression(
  runs: HistoryRun[],
): Map<string, TrendProgression> {
  const result = new Map<string, TrendProgression>();
  const latest = new Map<string, Map<string, HistoryRun>>();
  const starts = new Map<string, HistoryRun>();
  const anchors = new Map<string, HistoryRun | undefined>();
  // The API is newest first; preserve repository order when timestamps tie.
  const ordered = [...runs]
    .reverse()
    .filter((run) => run.qualityMeasured === true)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const run of ordered) {
    const context = trendContext(run),
      branch = trendBranch(run),
      identity = JSON.stringify([context, branch]);
    const byBranch = latest.get(context) ?? new Map<string, HistoryRun>();
    const otherBranch = () =>
      [...byBranch.entries()].reverse().find(([name]) => name !== branch)?.[1];
    if (!starts.has(identity)) {
      starts.set(identity, run);
      anchors.set(identity, otherBranch());
    }
    const same = byBranch.get(branch);
    const anchor = anchors.get(identity) ?? otherBranch();
    result.set(run.runId, {
      context,
      branch,
      previousSameBranch: same ? trendReference(run, same) : null,
      previousBranch: anchor ? trendReference(run, anchor) : null,
      branchStart: trendReference(run, starts.get(identity)!),
    });
    byBranch.delete(branch);
    byBranch.set(branch, run);
    latest.set(context, byBranch);
  }
  return result;
}
