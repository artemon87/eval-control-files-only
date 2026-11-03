import type { HistoryBranch, HistoryRun } from "./unit-history-types";
import type { FixedTimeWindow } from "./time-window";

export type HistoryTrendMetric = "passRate" | "duration";
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
  const value = metric === "passRate" ? run.passRatePct : run.durationMs;
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
) {
  return series.points.flatMap((point, index) => {
    const previous = series.points[index - 1];
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
