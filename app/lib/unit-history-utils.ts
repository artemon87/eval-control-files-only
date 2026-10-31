import type {
  HistoryCase,
  HistoryCaseCell,
  HistoryCaseState,
  UnitHistoryScope,
} from "./unit-history-types";

export type CasePatternView = "latest" | "period";
export type CasePatternFilter = "failed" | "recurring" | "all";

export function skillScopeKey(scope: UnitHistoryScope): string {
  return JSON.stringify([scope.skill, scope.githubRepository]);
}

export function patternFailureCount(
  item: HistoryCase,
  view: CasePatternView,
): number {
  return view === "period"
    ? item.affectedBranches
    : item.cells.filter((cell) => cell.latestState === "failed").length;
}

export function selectHistoryCases(
  cases: HistoryCase[],
  view: CasePatternView,
  filter: CasePatternFilter,
): HistoryCase[] {
  return cases
    .filter((item) => {
      const affected = patternFailureCount(item, view);
      return (
        filter === "all" ||
        (filter === "recurring" ? affected > 1 : affected > 0)
      );
    })
    .sort(
      (left, right) =>
        patternFailureCount(right, view) - patternFailureCount(left, view) ||
        right.failed - left.failed ||
        left.label.localeCompare(right.label),
    );
}

const STATE_LABELS: Record<HistoryCaseState, string> = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked / error",
  xpassed: "XPASS",
  skipped: "Skipped",
  pending: "Pending",
  not_run: "Not run",
  unavailable: "Unavailable",
};

export function caseCellLabel(
  cell: HistoryCaseCell,
  view: CasePatternView,
): string {
  if (view === "latest") return STATE_LABELS[cell.latestState];
  return cell.executions
    ? `${cell.failed} / ${cell.executions}`
    : "No matching runs";
}

export function caseCellContext(
  cell: HistoryCaseCell,
  view: CasePatternView,
): string {
  if (view === "latest")
    return `${STATE_LABELS[cell.latestState]} · ${cell.latestRunId}${cell.latestContextMatch ? "" : " · Different or incomplete recorded configuration"}`;
  return `${cell.failed} failed, ${cell.passed} passed, ${cell.blocked} blocked/error, ${cell.xpassed} XPASS, ${cell.skipped} skipped, ${cell.pending} pending in ${cell.executions} matching executions`;
}

export function historyTime(value: string): string {
  return (
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

export function rateLabel(value: number | null): string {
  if (value === null) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
