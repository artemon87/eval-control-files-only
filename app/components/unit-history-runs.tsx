"use client";
import { useState, type KeyboardEvent } from "react";
import type { HistoryRun } from "../lib/unit-history-types";
import { historyTime } from "../lib/unit-history-utils";
import styles from "./unit-trend-explorer.module.css";

function activateRow(
  event: KeyboardEvent<HTMLTableRowElement>,
  action: () => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function SupportingRunHistory({
  runs,
  openingRunId,
  onOpenRun,
}: {
  runs: HistoryRun[];
  openingRunId: string | null;
  onOpenRun: (runId: string, evalType: "unit") => void;
}) {
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(runs.length / size));
  const current = Math.min(page, pages - 1);
  const start = current * size;
  const open = (run: HistoryRun) => {
    if (openingRunId !== run.runId) onOpenRun(run.runId, "unit");
  };
  return (
    <details className={`panel ${styles.supporting}`}>
      <summary>Supporting run history · {runs.length} executions</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Run / recorded SHA</th>
              <th>Branch</th>
              <th>Result</th>
              <th>Run by</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(start, start + size).map((run) => (
              <tr
                key={run.runId}
                className="clickable-row"
                tabIndex={0}
                aria-label={`Open run ${run.runId}`}
                aria-busy={openingRunId === run.runId}
                onClick={() => open(run)}
                onKeyDown={(event) => activateRow(event, () => open(run))}
              >
                <td>
                  <button
                    className="run-link"
                    disabled={openingRunId === run.runId}
                    onClick={(event) => {
                      event.stopPropagation();
                      open(run);
                    }}
                  >
                    {openingRunId === run.runId ? "Opening…" : run.runId}
                  </button>
                  <small>
                    {run.gitSha?.slice(0, 8) ?? "SHA not recorded"}
                    {run.skillVersion ? ` · v${run.skillVersion}` : ""}
                  </small>
                </td>
                <td>
                  {run.branchLabel}
                  {!run.contextMatch && (
                    <small>Different / incomplete analysis settings</small>
                  )}
                </td>
                <td>
                  <strong>
                    {run.qualityMeasured === true &&
                    run.passed !== null &&
                    run.total !== null
                      ? `${run.passed}/${run.total} passed`
                      : run.executionStatus}
                  </strong>
                  <small>
                    {run.verdict}
                    {run.qualityMeasured !== true
                      ? " · Quality not measured"
                      : ""}
                  </small>
                </td>
                <td>
                  {run.actor ?? "Actor not recorded"}
                  {run.trigger && <small>{run.trigger}</small>}
                </td>
                <td>{historyTime(run.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="trend-pagination">
        <span>
          Showing {runs.length ? start + 1 : 0}–
          {Math.min(start + size, runs.length)} of {runs.length}
        </span>
        <label>
          Rows per page{" "}
          <select
            aria-label="Supporting history rows per page"
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {[10, 25, 50].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Supporting run history pages">
          <button disabled={!current} onClick={() => setPage(0)}>
            First
          </button>
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
          <button
            disabled={current >= pages - 1}
            onClick={() => setPage(pages - 1)}
          >
            Last
          </button>
        </nav>
      </div>
    </details>
  );
}
