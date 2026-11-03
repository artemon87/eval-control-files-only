"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EvalApi, UnitApiCase } from "../lib/eval-api";
import type { UnitHistoryInsights } from "../lib/unit-history-types";
import { historyTime, rateLabel } from "../lib/unit-history-utils";
import {
  comparableTrendRuns,
  trendComparisonBlockers,
  previousTrendRun,
  completeTrendCaseComparison,
  recordedCaseState,
  trendCaseRows,
} from "../lib/unit-trend-explorer";
import { UnitSkillPerformanceTrend } from "./unit-history-trend";
import { SupportingRunHistory } from "./unit-history-runs";
import { RecordedUnitCase } from "./unit-history-case-record";
import styles from "./unit-history-layout.module.css";

type Props = {
  chartRunIds?: string[] | null;
  chartCohortKey?: string | null;
  api: EvalApi | null;
  data: UnitHistoryInsights;
  openingRunId: string | null;
  onOpenRun: (id: string, type: "unit") => void;
};
const emptyRecords: UnitApiCase[] = [];
function activate(
  event: KeyboardEvent<HTMLTableRowElement>,
  action: () => void,
) {
  if (
    event.target === event.currentTarget &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    action();
  }
}
function Result({ value }: { value: string }) {
  return (
    <span
      className={`${styles.badge} ${value === "Passed" || value === "Recovered" ? styles.good : value === "Failed" || value === "New failure" ? styles.bad : ""}`}
    >
      {value}
    </span>
  );
}

export function UnitTrendExplorerContent({
  api,
  chartCohortKey = null,
  chartRunIds = null,
  data,
  openingRunId,
  onOpenRun,
}: Props) {
  const resultsSection = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [referenceChoice, setReferenceChoice] = useState("previous");
  const [filter, setFilter] = useState("changed");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [recordPage, setRecordPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    current: UnitApiCase[];
    reference: UnitApiCase[];
    error: string | null;
    referenceError: string | null;
  }>({
    key: "",
    current: [],
    reference: [],
    error: null,
    referenceError: null,
  });
  const run =
    data.runs.find((run) => run.runId === selectedId) ??
    data.runs.find(
      (run) =>
        (chartRunIds === null || chartRunIds.includes(run.runId)) &&
        (!chartCohortKey || run.cohortKey === chartCohortKey),
    ) ??
    data.runs[0];
  const reference = run
    ? referenceChoice === "previous"
      ? (data.runs.find(
          (item) => item.runId === run.progression?.previousExecution?.runId,
        ) ?? previousTrendRun(run, data.runs, data.cohorts))
      : referenceChoice === "none"
        ? undefined
        : data.runs.find(
            (item) =>
              item.runId === referenceChoice && item.runId !== run.runId,
          )
    : undefined;
  const metadataComparable = Boolean(
    run && comparableTrendRuns(run, reference, data.cohorts),
  );
  const requestRunId = run?.qualityMeasured === true ? run.runId : null;
  const requestReferenceId = reference?.runId ?? null;
  const key = JSON.stringify([requestRunId, requestReferenceId]);
  useEffect(() => {
    if (!api || !requestRunId) return;
    const controller = new AbortController();
    void Promise.allSettled([
      api.listUnitHistoryRunCases(requestRunId, controller.signal),
      requestReferenceId
        ? api.listUnitHistoryRunCases(requestReferenceId, controller.signal)
        : Promise.resolve(emptyRecords),
    ]).then(([current, earlier]) => {
      if (controller.signal.aborted) return;
      const message = (reason: unknown) =>
        reason instanceof Error
          ? reason.message
          : "Unable to load recorded case evidence";
      setResponse({
        key,
        current: current.status === "fulfilled" ? current.value : [],
        reference: earlier.status === "fulfilled" ? earlier.value : [],
        error: current.status === "rejected" ? message(current.reason) : null,
        referenceError:
          earlier.status === "rejected" ? message(earlier.reason) : null,
      });
    });
    return () => controller.abort();
  }, [api, requestRunId, requestReferenceId, key, retry]);
  const current = response.key === key ? response.current : emptyRecords;
  const earlier = response.key === key ? response.reference : emptyRecords;
  const loaded = response.key === key;
  const compared = Boolean(
    metadataComparable &&
      run &&
      reference &&
      loaded &&
      !response.error &&
      !response.referenceError &&
      completeTrendCaseComparison(current, earlier, run, reference),
  );
  const blockers = run
    ? trendComparisonBlockers(run, reference, data.cohorts)
    : [];
  const showReference = Boolean(reference);
  const rows = trendCaseRows(current, earlier, compared);
  const effectiveFilter = filter === "changed" && !compared ? "all" : filter;
  const filtered = rows.filter(
    (row) =>
      row.label.toLowerCase().includes(query.toLowerCase()) &&
      (effectiveFilter === "all" ||
        (effectiveFilter === "failed" &&
          row.current.some((record) => record.verdict === "failed")) ||
        (effectiveFilter === "changed" &&
          ["Recovered", "New failure"].includes(row.change))),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 10) - 1),
  );
  const inspected = rows.find((row) => row.key === caseKey);
  const currentRecordPage = Math.min(
    recordPage,
    Math.max(0, Math.ceil((inspected?.current.length ?? 0) / 10) - 1),
  );
  const selectRun = (id: string) => {
    setSelectedId(id);
    setHighlight(data.runs.find((run) => run.runId === id)?.branchKey ?? null);
    setReferenceChoice("previous");
    setPage(0);
    setCaseKey(null);
    setRecordPage(0);
  };
  if (!run)
    return (
      <section className="panel empty" role="status">
        No executions in this skill, stage, and target during the selected
        window.
      </section>
    );
  const measured = run.qualityMeasured === true;
  const changed = rows.filter(
    (row) => row.change === "Recovered" || row.change === "New failure",
  );
  const executionMessage =
    run.error ??
    data.executionIssues?.find(
      (issue) => issue.runId === run.runId && issue.error,
    )?.error;
  return (
    <>
      <UnitSkillPerformanceTrend
        data={data}
        selectedCohortKey={chartCohortKey}
        visibleRunIds={chartRunIds}
        focusedBranch={highlight}
        selectedRunId={run.runId}
        openingRunId={openingRunId}
        onOpenRun={onOpenRun}
        onInspectRun={selectRun}
        onReferenceRun={setReferenceChoice}
        onInspectReference={(id, selectedId) => {
          setSelectedId(selectedId);
          setReferenceChoice(id);
          setPage(0);
          setCaseKey(null);
          requestAnimationFrame(() => {
            resultsSection.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
            resultsSection.current?.focus({ preventScroll: true });
          });
        }}
        onHighlightBranch={setHighlight}
      />
      <div className={styles.selectedHeader}>
        <button
          className={styles.selectedRun}
          disabled={openingRunId === run.runId}
          aria-label={`Open selected run ${run.runId}`}
          onClick={() => onOpenRun(run.runId, "unit")}
        >
          <span className="eyebrow">Selected execution</span>
          <strong>{run.branchLabel}</strong>
          <small>
            {openingRunId === run.runId ? "Opening…" : run.runId} ·{" "}
            {run.gitSha?.slice(0, 8) ?? "SHA not recorded"} ·{" "}
            {historyTime(run.startedAt)} · Run by{" "}
            {run.actor ?? "Actor not recorded"}
          </small>
        </button>
        <span className={styles.badge}>
          {measured ? "Measured execution" : "Quality not measured"} · Recorded
          verdict: {run.verdict}
        </span>
      </div>
      <section className={styles.cards} aria-label="Selected run summary">
        {[
          [
            "Cases evaluated",
            measured ? run.total : null,
            measured
              ? "Cases in selected execution"
              : "No complete measurement",
          ],
          ["Passed", measured ? run.passed : null, "Recorded passed verdicts"],
          [
            "Failed",
            measured && run.total !== null && run.passed !== null
              ? run.total - run.passed
              : null,
            "Recorded failed verdicts",
          ],
          [
            "Pass rate",
            measured ? rateLabel(run.passRatePct) : null,
            metadataComparable &&
            run.passRatePct !== null &&
            reference?.passRatePct !== null &&
            reference?.passRatePct !== undefined
              ? `${run.passRatePct - reference.passRatePct > 0 ? "+" : ""}${Number((run.passRatePct - reference.passRatePct).toFixed(1))} pp vs reference`
              : "Selected execution only",
          ],
        ].map(([title, value, caption]) => (
          <div className={`panel ${styles.stat}`} key={title}>
            <span>{title}</span>
            <strong>{value ?? "—"}</strong>
            <small>{caption}</small>
          </div>
        ))}
      </section>
      <section
        ref={resultsSection}
        tabIndex={-1}
        className="panel"
        aria-label="Execution test results"
      >
        <div className="panel-heading">
          <div>
            <h2>
              {compared
                ? "Test changes between executions"
                : "Results for this run"}
            </h2>
            <p>
              {compared
                ? `${rows.filter((row) => row.change === "Recovered").length} recovered · ${rows.filter((row) => row.change === "New failure").length} newly failed · ${rows.length - changed.length} unchanged`
                : "Recorded evidence from the selected execution"}
            </p>
          </div>
        </div>
        <div className={styles.testControls}>
          <label className={styles.referenceControl}>
            Reference execution · compare with
            <select
              aria-label="Reference execution"
              value={referenceChoice}
              onChange={(event) => {
                setReferenceChoice(event.target.value);
                setPage(0);
                setCaseKey(null);
              }}
            >
              <option value="previous">
                {referenceChoice === "previous" && !reference
                  ? "No compatible earlier run · choose a reference below"
                  : "Previous compatible run in this branch · automatic"}
              </option>
              <option value="none">None · selected results only</option>
              {data.runs
                .filter(
                  (item) => item.runId !== run.runId && item.qualityMeasured,
                )
                .map((item) => (
                  <option key={item.runId} value={item.runId}>
                    {item.branchLabel} ·{" "}
                    {item.gitSha?.slice(0, 8) ?? "SHA not recorded"} ·{" "}
                    {historyTime(item.startedAt)} ·{" "}
                    {rateLabel(item.passRatePct)} · {item.runId} · BSA{" "}
                    {item.bsaVersion ?? "not recorded"}
                    {comparableTrendRuns(run, item, data.cohorts)
                      ? " · comparable"
                      : " · recorded results only"}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div
          className={styles.note}
          role="status"
          aria-label="Comparison status"
        >
          <p>
            <strong>Selected execution:</strong> {run.runId} ·{" "}
            {historyTime(run.startedAt)} · BSA{" "}
            {run.bsaVersion ?? "not recorded"}
          </p>
          <p>
            <strong>Reference execution:</strong>{" "}
            {reference
              ? `${reference.runId} · ${historyTime(reference.startedAt)} · BSA ${reference.bsaVersion ?? "not recorded"}`
              : "None"}
          </p>
          {!compared && blockers.length > 0 && (
            <>
              <strong>Change analysis unavailable</strong>
              <ul>
                {blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {reference && (
                <p>
                  Showing recorded results side by side. These settings are not
                  treated as equivalent.
                </p>
              )}
            </>
          )}
        </div>
        <div className={styles.note}>
          {!measured
            ? "This execution has no complete quality measurement. It is not a measured skill regression."
            : reference
              ? metadataComparable
                ? `Reference: ${reference.branchLabel} · ${reference.gitSha?.slice(0, 8) ?? "SHA not recorded"} · ${historyTime(reference.startedAt)}. Matching recorded case identities, thresholds, and configuration; this does not prove identical prompt content or code-change causality.`
                : "Different or incomplete recorded case sets/settings. Deltas are unavailable; selected-run results remain inspectable."
              : referenceChoice === "none"
                ? "No reference selected. Showing selected-run results."
                : "No earlier comparable execution in this branch within the selected window. No unrelated branch is used automatically."}
          {measured && run.passRateThreshold != null && (
            <p>
              Recorded quality threshold: {rateLabel(run.passRateThreshold)} ·{" "}
              {(run.passRatePct ?? 0) >= run.passRateThreshold
                ? "Met"
                : "Not met"}
              . This is not a PR approval status.
            </p>
          )}
        </div>
        {!measured ? (
          <div className={styles.note} role="status">
            <strong>Execution status: {run.executionStatus}</strong>
            <p>
              {executionMessage ??
                "Complete final case evidence was not recorded. Open the selected run to inspect its available records; no root cause is inferred."}
            </p>
          </div>
        ) : !api ? (
          <div className="empty">Connect to load recorded case results.</div>
        ) : !loaded ? (
          <div className="empty" role="status">
            Loading complete case evidence…
          </div>
        ) : response.error ? (
          <div className="empty" role="alert">
            {response.error}
            <button
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry test evidence
            </button>
          </div>
        ) : (
          <>
            {response.referenceError && (
              <div className={styles.note} role="alert">
                Reference evidence could not be loaded:{" "}
                {response.referenceError}. Recorded reference results are
                unavailable; no changes are inferred.{" "}
                <button
                  className="secondary-button"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry reference evidence
                </button>
              </div>
            )}
            {metadataComparable && !compared && !response.referenceError && (
              <p className={styles.note}>
                The loaded case records are incomplete, ambiguous, or differ
                from the recorded comparison metadata. No case changes are
                inferred.
              </p>
            )}
            <div className={styles.testControls}>
              <label>
                Filter tests
                <input
                  aria-label="Filter tests"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Filter tests"
                />
              </label>
              <label>
                Show
                <select
                  aria-label="Test results filter"
                  value={effectiveFilter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="changed" disabled={!compared}>
                    Changed tests
                  </option>
                  <option value="failed">Failed in selected run</option>
                  <option value="all">All tests</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table
                className={`${styles.resultsTable} ${showReference ? styles.resultsTableWithReference : ""}`}
              >
                <thead>
                  <tr>
                    <th>Test</th>
                    {showReference && <th>Reference result</th>}
                    <th>Selected run result</th>
                    {compared && <th>Observed change</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice(currentPage * 10, currentPage * 10 + 10)
                    .map((row) => {
                      const now =
                          row.current.length === 1
                            ? recordedCaseState(row.current[0])
                            : "Multiple records",
                        before = response.referenceError
                          ? "Unavailable"
                          : row.reference.length > 1
                            ? "Multiple records"
                            : recordedCaseState(row.reference[0]);
                      return (
                        <tr
                          key={row.key}
                          className="clickable-row"
                          tabIndex={0}
                          aria-label={`Inspect test ${row.label} ${row.testType}`}
                          onClick={() => {
                            setCaseKey(row.key);
                            setRecordPage(0);
                          }}
                          onKeyDown={(event) =>
                            activate(event, () => {
                              setCaseKey(row.key);
                              setRecordPage(0);
                            })
                          }
                        >
                          <td>
                            <button
                              className="run-link"
                              onClick={(event) => {
                                event.stopPropagation();
                                setCaseKey(row.key);
                                setRecordPage(0);
                              }}
                            >
                              {row.label}
                            </button>
                            <small>{row.testType}</small>
                            {showReference && (
                              <span className={styles.mobileReference}>
                                Reference: {before}
                              </span>
                            )}
                          </td>
                          {showReference && (
                            <td>
                              <Result value={before} />
                            </td>
                          )}
                          <td>
                            <Result value={now} />
                          </td>
                          {compared && (
                            <td>
                              <Result value={row.change} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="empty" role="status">
                No tests match this filter.{" "}
                <button
                  className="secondary-button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    setPage(0);
                  }}
                >
                  Show all tests
                </button>
              </div>
            )}
            <div className="trend-pagination">
              <span>
                Tests {filtered.length ? currentPage * 10 + 1 : 0}–
                {Math.min((currentPage + 1) * 10, filtered.length)} of{" "}
                {filtered.length}
              </span>
              <nav aria-label="Test result pages">
                <button
                  disabled={!currentPage}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous tests
                </button>
                <button
                  disabled={(currentPage + 1) * 10 >= filtered.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next tests
                </button>
              </nav>
            </div>
            {inspected && (
              <div aria-label="Recorded test evidence" role="region">
                <div
                  className={styles.selectedHeader}
                  style={{ padding: "0 18px" }}
                >
                  <strong>{inspected.label} · recorded evidence</strong>
                  <button
                    className="secondary-button"
                    onClick={() => setCaseKey(null)}
                  >
                    Close details
                  </button>
                </div>
                {inspected.current
                  .slice(currentRecordPage * 10, currentRecordPage * 10 + 10)
                  .map((record, index) => (
                    <RecordedUnitCase
                      key={`${key}:${inspected.key}:${currentRecordPage}:${index}`}
                      record={record}
                    />
                  ))}
                {inspected.current.length > 10 && (
                  <div className="trend-pagination">
                    <span>
                      Records {currentRecordPage * 10 + 1}–
                      {Math.min(
                        (currentRecordPage + 1) * 10,
                        inspected.current.length,
                      )}{" "}
                      of {inspected.current.length}
                    </span>
                    <nav aria-label="Recorded test evidence pages">
                      <button
                        disabled={!currentRecordPage}
                        onClick={() => setRecordPage(currentRecordPage - 1)}
                      >
                        Previous
                      </button>
                      <button
                        disabled={
                          (currentRecordPage + 1) * 10 >=
                          inspected.current.length
                        }
                        onClick={() => setRecordPage(currentRecordPage + 1)}
                      >
                        Next
                      </button>
                    </nav>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
      <SupportingRunHistory
        runs={data.runs}
        openingRunId={openingRunId}
        onOpenRun={onOpenRun}
      />
    </>
  );
}
