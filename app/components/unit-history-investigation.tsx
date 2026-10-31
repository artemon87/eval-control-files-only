"use client";

import { useEffect, useState } from "react";
import type { EvalApi, UnitApiCase } from "../lib/eval-api";
import type {
  HistoryCase,
  HistoryRun,
  UnitHistoryInsights,
} from "../lib/unit-history-types";
import { historyTime, rateLabel } from "../lib/unit-history-utils";
import styles from "./unit-history-insights.module.css";

export function HistoryExecution({
  run,
  onOpenRun,
}: {
  run: HistoryRun;
  onOpenRun: (id: string, type: "unit") => void;
}) {
  const measured = run.qualityMeasured === true;
  return (
    <section className="panel" aria-label="Selected execution">
      <div className="panel-heading">
        <div>
          <h2>Selected execution · {run.branchLabel}</h2>
          <p>
            {historyTime(run.startedAt)} · Run by{" "}
            {run.actor ?? "Actor not recorded"} · SHA{" "}
            {run.gitSha?.slice(0, 8) ?? "Not recorded"}
          </p>
        </div>
        <button
          className="run-link"
          onClick={() => onOpenRun(run.runId, "unit")}
        >
          {run.runId}
        </button>
      </div>
      <div className={styles.caseEvidence}>
        <strong>
          {measured
            ? `${rateLabel(run.passRatePct)} · ${run.passed} passed · ${(run.total ?? 0) - (run.passed ?? 0)} failed`
            : "No complete quality measurement"}
        </strong>
        <p>
          {measured
            ? "Observed result for this execution. Branch direction compares recorded updates within this branch, not unrelated branches or a presumed main baseline."
            : `Execution status: ${run.executionStatus} · verdict: ${run.verdict}. Blocked, incomplete or non-final case results are not scored as a quality decline.`}
        </p>
        {measured && run.passRateThreshold != null && (
          <p>
            Recorded quality threshold: {rateLabel(run.passRateThreshold)} ·{" "}
            {(run.passRatePct ?? 0) >= run.passRateThreshold
              ? "Met"
              : "Not met"}
            . This is not a PR approval status.
          </p>
        )}
        {run.error && <pre className={styles.recordedText}>{run.error}</pre>}
      </div>
    </section>
  );
}

export function HistoryCaseInvestigation({
  api,
  data,
  item,
  runId,
  onSelectRun,
}: {
  api: EvalApi | null;
  data: UnitHistoryInsights;
  item: HistoryCase;
  runId: string;
  onSelectRun: (id: string) => void;
}) {
  const [response, setResponse] = useState<{
    id: string;
    items: UnitApiCase[];
    error: string | null;
  }>({ id: "", items: [], error: null });
  const [retry, setRetry] = useState(0);
  const [recordPage, setRecordPage] = useState(0);
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .listUnitHistoryRunCases(runId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setResponse({ id: runId, items, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResponse({
            id: runId,
            items: [],
            error:
              error instanceof Error
                ? error.message
                : "Unable to load recorded case evidence",
          });
      });
    return () => controller.abort();
  }, [api, runId, retry]);
  const records =
    response.id === runId
      ? response.items.filter(
          (record) =>
            (record.test_name?.trim() || record.case_id?.trim()) ===
              item.label &&
            (record.test_type?.trim() || null) === item.testType,
        )
      : [];
  const page = Math.min(
    recordPage,
    Math.max(0, Math.ceil(records.length / 10) - 1),
  );
  const run = data.runs.find((run) => run.runId === runId);
  return (
    <section className="panel" aria-label="Case investigation">
      <div className="panel-heading">
        <div>
          <h2>Case investigation · {item.label}</h2>
          <p>
            Recorded evidence from one selected execution. Earlier results are
            never substituted for missing evidence.
          </p>
        </div>
      </div>
      <div className={styles.investigationControls}>
        <label>
          Execution
          <select
            aria-label="Case investigation execution"
            value={runId}
            onChange={(event) => {
              setRecordPage(0);
              onSelectRun(event.target.value);
            }}
          >
            {data.runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {historyTime(run.startedAt)} · {run.branchLabel} ·{" "}
                {run.gitSha?.slice(0, 8) ?? "SHA not recorded"} · {run.runId}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!api ? (
        <p className="empty">Connect to load recorded case evidence.</p>
      ) : response.id !== runId ? (
        <p className="empty" role="status">
          Loading recorded case evidence…
        </p>
      ) : response.error ? (
        <div className="empty" role="alert">
          {response.error}
          <button
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry case evidence
          </button>
        </div>
      ) : !records.length ? (
        <p className="empty" role="status">
          No record for this case and test type in {runId}.{" "}
          {run?.casesComplete
            ? "The case may not have been run."
            : "Case evidence is incomplete; no case verdict can be established."}
        </p>
      ) : (
        records
          .slice(page * 10, page * 10 + 10)
          .map((record, index) => (
            <RecordedCase key={`${runId}:${page}:${index}`} record={record} />
          ))
      )}
      {records.length > 10 && (
        <div className="trend-pagination">
          <span>
            Records {page * 10 + 1}–{Math.min((page + 1) * 10, records.length)}{" "}
            of {records.length}
          </span>
          <nav aria-label="Case evidence records">
            <button disabled={!page} onClick={() => setRecordPage(page - 1)}>
              Previous
            </button>
            <button
              disabled={(page + 1) * 10 >= records.length}
              onClick={() => setRecordPage(page + 1)}
            >
              Next
            </button>
          </nav>
        </div>
      )}
    </section>
  );
}

function RecordedCase({ record }: { record: UnitApiCase }) {
  const metrics = [
    ...new Set([
      ...Object.keys(record.scores ?? {}),
      ...Object.keys(record.thresholds ?? {}),
    ]),
  ];
  return (
    <div className={styles.caseEvidence}>
      <strong>
        {record.case_id} · Recorded verdict: {record.verdict}
      </strong>
      <p>
        Case verdicts and metric thresholds are recorded evidence, not an
        inferred root cause. Missing scores or thresholds remain unknown.
      </p>
      {!!metrics.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Recorded score</th>
                <th>Recorded minimum</th>
                <th>Threshold check</th>
                <th>Recorded explanation</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const score = record.scores?.[metric],
                  threshold = record.thresholds?.[metric];
                const known =
                  ["passed", "failed"].includes(record.verdict) &&
                  typeof score === "number" &&
                  Number.isFinite(score) &&
                  typeof threshold === "number" &&
                  Number.isFinite(threshold);
                return (
                  <tr key={metric}>
                    <th scope="row">{metric}</th>
                    <td>{score ?? "Not recorded"}</td>
                    <td>{threshold ?? "Not recorded"}</td>
                    <td>
                      {known
                        ? score >= threshold
                          ? "Met"
                          : "Below minimum"
                        : "Unknown"}
                    </td>
                    <td>
                      {record.score_explanations?.[metric] ?? "Not recorded"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!metrics.length && <p>No metric scores or thresholds were recorded.</p>}
      {record.error && (
        <>
          <h3>Recorded error</h3>
          <pre className={styles.recordedText}>{record.error}</pre>
        </>
      )}
      <div className={styles.evidenceColumns}>
        <details>
          <summary>Expected response</summary>
          <pre className={styles.recordedText}>
            {record.expected_response ?? "Not recorded"}
          </pre>
        </details>
        <details>
          <summary>Recorded response</summary>
          <pre className={styles.recordedText}>
            {record.response ?? "Not recorded"}
          </pre>
        </details>
        <details>
          <summary>Validation output</summary>
          <pre className={styles.recordedText}>
            {record.validation_result == null
              ? "Not recorded"
              : JSON.stringify(record.validation_result, null, 2)}
          </pre>
        </details>
        <details>
          <summary>Recorded tool calls</summary>
          <pre className={styles.recordedText}>
            {record.tool_calls?.length
              ? JSON.stringify(record.tool_calls, null, 2)
              : "Not recorded"}
          </pre>
        </details>
      </div>
    </div>
  );
}

export function HistoryExecutionIssues({
  data,
  onInspectRun,
}: {
  data: UnitHistoryInsights;
  onInspectRun: (
    id: string,
    caseName?: string | null,
    testType?: string | null,
  ) => void;
}) {
  const issues = data.executionIssues ?? [];
  const [page, setPage] = useState(0);
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(issues.length / 10) - 1),
  );
  return (
    <section className="panel" aria-label="Execution issues">
      <div className="panel-heading">
        <div>
          <h2>What prevented evaluation?</h2>
          <p>
            Recorded blocked/error cases and executions in the entire selected
            window. These are execution issues, not failed quality verdicts.
          </p>
        </div>
        <span className="result-count">{issues.length} issue records</span>
      </div>
      {!issues.length ? (
        <p className="empty">
          No recorded blocked or error executions in this window.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run / branch</th>
                  <th>Case</th>
                  <th>Recorded error</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {issues
                  .slice(current * 10, current * 10 + 10)
                  .map((issue, index) => {
                    const run = data.runs.find(
                      (run) => run.runId === issue.runId,
                    );
                    return (
                      <tr
                        key={`${issue.runId}:${current}:${index}`}
                        className="clickable-row"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            onInspectRun(
                              issue.runId,
                              issue.caseName,
                              issue.testType,
                            );
                          }
                        }}
                        onClick={() =>
                          onInspectRun(
                            issue.runId,
                            issue.caseName,
                            issue.testType,
                          )
                        }
                      >
                        <td>
                          <button
                            className="run-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              onInspectRun(
                                issue.runId,
                                issue.caseName,
                                issue.testType,
                              );
                            }}
                          >
                            {issue.runId}
                          </button>
                          <small>
                            {run?.branchLabel ?? "Branch not recorded"} ·{" "}
                            {run?.gitSha?.slice(0, 8) ?? "SHA not recorded"}
                          </small>
                        </td>
                        <td>
                          {issue.caseName ?? "Run-level execution issue"}
                          <small>{issue.testType}</small>
                        </td>
                        <td>
                          <pre className={styles.recordedText}>
                            {issue.error ??
                              "No error message recorded. Inspect the run; no root cause is inferred."}
                          </pre>
                        </td>
                        <td>{historyTime(issue.startedAt)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="trend-pagination">
            <span>
              {current * 10 + 1}–{Math.min((current + 1) * 10, issues.length)}{" "}
              of {issues.length}
            </span>
            <nav aria-label="Execution issue pages">
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                Previous
              </button>
              <button
                disabled={(current + 1) * 10 >= issues.length}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </nav>
          </div>
        </>
      )}
    </section>
  );
}
