"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { EvalApi } from "../lib/eval-api";
import { fixedTimeWindow } from "../lib/time-window";
import type {
  HistoryBranch,
  HistoryCase,
  HistoryCaseCell,
  HistoryCommit,
  HistoryRun,
  UnitHistoryFocus,
  UnitHistoryInsights,
  UnitHistoryQuery,
  UnitHistoryScope,
} from "../lib/unit-history-types";
import {
  caseCellContext,
  caseCellLabel,
  historyTime,
  patternFailureCount,
  rateLabel,
  selectHistoryCases,
  skillScopeKey,
  type CasePatternFilter,
  type CasePatternView,
} from "../lib/unit-history-utils";
import styles from "./unit-history-insights.module.css";

interface Props {
  api: EvalApi | null;
  revision: number;
  initialFocus?: UnitHistoryFocus;
  openingRunId: string | null;
  onOpenRun: (runId: string, evalType: "unit") => void;
  onShowE2E: () => void;
}

export function UnitHistoryInsightsView({
  api,
  revision,
  initialFocus,
  onShowE2E,
  ...navigation
}: Props) {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [refresh, setRefresh] = useState(0);
  const [skillChoice, setSkillChoice] = useState("");
  const [stageChoice, setStageChoice] = useState("");
  const [targetChoice, setTargetChoice] = useState("");
  const [cohortChoice, setCohortChoice] = useState({
    key: "",
    scopeKey: "",
    revision: 0,
  });
  const [catalog, setCatalog] = useState<{
    items: UnitHistoryScope[];
    loaded: boolean;
    error: string | null;
  }>({ items: [], loaded: false, error: null });
  const [response, setResponse] = useState<{
    key: string;
    data: UnitHistoryInsights | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const timeWindow = useMemo(
    () => fixedTimeWindow(range, new Date(Math.max(anchor, revision))),
    [range, anchor, revision],
  );

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .listUnitHistoryScopes(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setCatalog({ items, loaded: true, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setCatalog((current) => ({
            ...current,
            loaded: true,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load History scopes",
          }));
      });
    return () => controller.abort();
  }, [api, revision, refresh]);

  const skills = Array.from(
    new Map(
      catalog.items.map((scope) => [skillScopeKey(scope), scope]),
    ).values(),
  );
  const preferred = catalog.items.find(
    (scope) => scope.skill === initialFocus?.skillId,
  );
  const skill =
    skills.find((scope) => skillScopeKey(scope) === skillChoice) ??
    preferred ??
    skills[0];
  const skillScopes = catalog.items.filter(
    (scope) => skill && skillScopeKey(scope) === skillScopeKey(skill),
  );
  const stages = [...new Set(skillScopes.map((scope) => scope.stage))].sort();
  const stage = stages.includes(stageChoice)
    ? stageChoice
    : stages.includes(initialFocus?.stage ?? "")
      ? initialFocus!.stage!
      : stages[0];
  const targets = skillScopes.filter((scope) => scope.stage === stage);
  const scope =
    targets.find((item) => item.scopeKey === targetChoice) ??
    targets.find(
      (item) =>
        item.targetEnvironment === initialFocus?.targetEnvironment &&
        (!initialFocus?.environment ||
          item.environment === initialFocus.environment),
    ) ??
    targets[0];
  const requestKey = JSON.stringify({
    query: {
      scopeKey: scope?.scopeKey,
      ...timeWindow,
      cohortKey:
        cohortChoice.scopeKey === scope?.scopeKey &&
        cohortChoice.revision === revision
          ? cohortChoice.key || undefined
          : undefined,
    },
    refresh,
  });

  useEffect(() => {
    if (!api) return;
    const { query } = JSON.parse(requestKey) as { query: UnitHistoryQuery };
    if (!query.scopeKey) return;
    const controller = new AbortController();
    void api
      .getUnitHistoryInsights(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResponse({
            key: requestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load skill insights",
          });
      });
    return () => controller.abort();
  }, [api, requestKey]);

  const refreshHistory = () => {
    setCohortChoice({ key: "", scopeKey: "", revision });
    setAnchor(Date.now());
    setRefresh((value) => value + 1);
  };
  const resetCohort = () =>
    setCohortChoice({ key: "", scopeKey: "", revision });
  const loading = Boolean(scope) && response.key !== requestKey;
  const data = response.key === requestKey ? response.data : null;
  const error = response.key === requestKey ? response.error : null;
  return (
    <div className={styles.root}>
      <div className="page-heading history-heading">
        <div>
          <span className="eyebrow">Longitudinal quality</span>
          <h1>Skill insights</h1>
          <p>The health and evolution of a skill across its branches.</p>
        </div>
        <div className="type-switch">
          <button onClick={onShowE2E}>E2E history</button>
          <button className="active" aria-pressed="true">
            Unit skill history
          </button>
        </div>
      </div>
      <section
        className={`panel ${styles.controls}`}
        aria-label="History scope"
      >
        <label>
          <span>Skill / repository</span>
          <select
            aria-label="History skill"
            value={skill ? skillScopeKey(skill) : ""}
            disabled={!skills.length}
            onChange={(event) => {
              setSkillChoice(event.target.value);
              setStageChoice("");
              setTargetChoice("");
              resetCohort();
            }}
          >
            {skills.map((item) => (
              <option key={skillScopeKey(item)} value={skillScopeKey(item)}>
                {item.skill} ·{" "}
                {item.githubRepository ?? "Repository not recorded"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Stage</span>
          <select
            aria-label="History stage"
            value={stage ?? ""}
            disabled={!stages.length}
            onChange={(event) => {
              setStageChoice(event.target.value);
              setTargetChoice("");
              resetCohort();
            }}
          >
            {stages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Target</span>
          <select
            aria-label="History target"
            value={scope?.scopeKey ?? ""}
            disabled={!targets.length}
            onChange={(event) => {
              setTargetChoice(event.target.value);
              resetCohort();
            }}
          >
            {targets.map((item) => (
              <option key={item.scopeKey} value={item.scopeKey}>
                {item.targetEnvironment ?? "Target not recorded"} ·{" "}
                {item.environment}
              </option>
            ))}
          </select>
        </label>
        <div className="range-switch" aria-label="History time window">
          {(["7d", "30d", "90d"] as const).map((value) => (
            <button
              key={value}
              className={range === value ? "active" : ""}
              aria-pressed={range === value}
              onClick={() => {
                setRange(value);
                setAnchor(Date.now());
                resetCohort();
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <button className="secondary-button" onClick={refreshHistory}>
          ↻ Refresh
        </button>
      </section>
      {catalog.error && (
        <div className="toast toast--error" role="alert">
          {catalog.error}
          <button onClick={refreshHistory}>Retry</button>
        </div>
      )}
      {!catalog.loaded && (
        <section className="panel empty" role="status">
          Loading recorded skills, stages, and targets…
        </section>
      )}
      {catalog.loaded && !catalog.error && !scope && (
        <section className="panel empty">
          No recorded unit evaluation scopes are available.
        </section>
      )}
      {loading && (
        <section className="panel empty" role="status">
          Loading branch and case insights for the full selected window…
        </section>
      )}
      {error && (
        <div className="toast toast--error" role="alert">
          {error}
          <button onClick={refreshHistory}>Retry</button>
        </div>
      )}
      {data && (
        <>
          <div className={styles.contextLine}>
            <span>
              {data.branches.length} branches · {data.runs.length} executions ·{" "}
              {historyTime(data.startedFrom)}–{historyTime(data.startedBefore)}
            </span>
            {!!data.cohorts.length && (
              <label>
                Analysis configuration{" "}
                <select
                  aria-label="History analysis configuration"
                  value={data.selectedCohortKey ?? ""}
                  onChange={(event) =>
                    setCohortChoice({
                      key: event.target.value,
                      scopeKey: scope?.scopeKey ?? "",
                      revision,
                    })
                  }
                >
                  {data.cohorts.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label} · {item.runCount} runs
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {data.cohorts.length > 1 && (
            <details className={styles.analysisDetails}>
              <summary>Recorded settings for frequency analysis</summary>
              <ul>
                {data.cohorts
                  .find((item) => item.key === data.selectedCohortKey)
                  ?.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
              </ul>
            </details>
          )}
          <HistoryInsightContent key={requestKey} data={data} {...navigation} />
        </>
      )}
    </div>
  );
}

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

export function HistoryInsightContent({
  data,
  openingRunId,
  onOpenRun,
}: {
  data: UnitHistoryInsights;
  openingRunId: string | null;
  onOpenRun: Props["onOpenRun"];
}) {
  const [focusedBranch, setFocusedBranch] = useState<string | null>(null);
  const [focusedCommit, setFocusedCommit] = useState<string | null>(null);
  const [expandedBranches, setExpandedBranches] = useState<string[]>([]);
  const [branchPage, setBranchPage] = useState(0);
  const [view, setView] = useState<CasePatternView>("latest");
  const [filter, setFilter] = useState<CasePatternFilter>("failed");
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [casePagination, setCasePagination] = useState({ key: "", page: 0 });
  const matching = data.cohorts.find(
    (cohort) => cohort.key === data.selectedCohortKey,
  );
  const recurring = data.cases.find(
    (item) => item.key === data.signals.recurringCaseKey,
  );
  const filtered = selectHistoryCases(data.cases, view, filter);
  const pageKey = `${view}:${filter}`;
  const currentCasePage =
    casePagination.key === pageKey
      ? Math.min(
          casePagination.page,
          Math.max(0, Math.ceil(filtered.length / 25) - 1),
        )
      : 0;
  const visibleCases = filtered.slice(
    currentCasePage * 25,
    (currentCasePage + 1) * 25,
  );
  const inspected =
    filtered.find((item) => item.key === selectedCase) ?? filtered[0];
  const focus = data.branches.find((item) => item.key === focusedBranch);
  const commit = focus?.commits.find((item) => item.key === focusedCommit);
  const focusBranch = (branch: HistoryBranch, chosen?: HistoryCommit) => {
    setFocusedBranch(branch.key);
    setFocusedCommit((chosen ?? branch.commits.at(-1))?.key ?? null);
    setBranchPage(Math.floor(data.branches.indexOf(branch) / 10));
  };
  const showPattern = (
    nextView: CasePatternView,
    nextFilter: CasePatternFilter,
    key: string | null,
  ) => {
    setView(nextView);
    setFilter(nextFilter);
    setSelectedCase(key);
    const index = selectHistoryCases(
      data.cases,
      nextView,
      nextFilter,
    ).findIndex((item) => item.key === key);
    setCasePagination({
      key: `${nextView}:${nextFilter}`,
      page: Math.floor(Math.max(0, index) / 25),
    });
  };
  const signalFocus = (kind: "recurring" | "inconsistent" | "coverage") => {
    if (kind === "recurring")
      showPattern("period", "failed", recurring?.key ?? null);
    if (kind === "inconsistent")
      showPattern(
        "period",
        "all",
        data.signals.inconsistentCaseKeys[0] ?? null,
      );
    if (kind === "coverage") {
      showPattern("latest", "all", null);
      const branch = data.branches.find(
        (item) => item.key === data.signals.coverageGapBranchKeys[0],
      );
      if (branch) focusBranch(branch);
    }
  };

  return (
    <>
      {!data.runs.length && (
        <section className="panel empty" role="status">
          No executions in this skill, stage, and target during the selected
          window.
        </section>
      )}
      {!!data.runs.length && (
        <>
          <section className="panel" aria-label="Branch evolution">
            <div className="panel-heading">
              <div>
                <h2>What changed on each branch?</h2>
                <p>
                  Observed direction from first to latest evaluated update ·
                  every branch stays in scope.
                </p>
              </div>
              <span className="result-count">
                {data.branches.length} branches
              </span>
            </div>
            <div className={styles.branchHeader}>
              <span>Recorded branch</span>
              <span>Evaluated updates · oldest → latest</span>
              <span>Branch direction</span>
            </div>
            {data.branches
              .slice(branchPage * 10, (branchPage + 1) * 10)
              .map((branch) => {
                const expanded = expandedBranches.includes(branch.key);
                const commits = expanded
                  ? branch.commits
                  : branch.commits.slice(0, 5);
                return (
                  <div
                    key={branch.key}
                    className={`${styles.branchRow} ${focusedBranch === branch.key ? styles.focused : ""}`}
                  >
                    <button
                      className={styles.branchName}
                      onClick={() => focusBranch(branch)}
                    >
                      <strong>{branch.label}</strong>
                      <small>
                        Latest run by{" "}
                        {branch.latestActor ?? "Actor not recorded"} ·{" "}
                        {historyTime(branch.latestAt)}
                      </small>
                    </button>
                    <div className={styles.commits}>
                      {commits.map((item) => (
                        <button
                          key={item.key}
                          className={`${styles.commit} ${focusedCommit === item.key && focusedBranch === branch.key ? styles.selectedCommit : ""}`}
                          aria-pressed={
                            focusedCommit === item.key &&
                            focusedBranch === branch.key
                          }
                          onClick={() => focusBranch(branch, item)}
                          aria-label={`${branch.label}, ${item.sha ?? "SHA not recorded"}, ${item.runIds.length} executions`}
                        >
                          <strong>
                            {rateLabel(item.lowPassRate)}
                            {item.highPassRate !== item.lowPassRate
                              ? `–${rateLabel(item.highPassRate)}`
                              : ""}
                          </strong>
                          <code>
                            {item.sha?.slice(0, 7) ?? "SHA not recorded"}
                          </code>
                          <small>
                            {item.runIds.length} run
                            {item.runIds.length === 1 ? "" : "s"}
                          </small>
                        </button>
                      ))}
                      {!expanded && branch.commits.length > 5 && (
                        <button
                          onClick={() =>
                            setExpandedBranches((items) => [
                              ...items,
                              branch.key,
                            ])
                          }
                        >
                          Show {branch.commits.length - 5} more
                        </button>
                      )}
                    </div>
                    <BranchDirection branch={branch} />
                  </div>
                );
              })}
            {data.branches.length > 10 && (
              <div className="trend-pagination">
                <span>
                  {branchPage * 10 + 1}–
                  {Math.min((branchPage + 1) * 10, data.branches.length)} of{" "}
                  {data.branches.length}
                </span>
                <nav aria-label="Branch pages">
                  <button
                    disabled={!branchPage}
                    onClick={() => setBranchPage((page) => page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={(branchPage + 1) * 10 >= data.branches.length}
                    onClick={() => setBranchPage((page) => page + 1)}
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}
            <div className={styles.branchContext}>
              {focus ? (
                <>
                  <span>
                    {focus.label} ·{" "}
                    {commit?.sha?.slice(0, 7) ?? "SHA not recorded"} ·{" "}
                    {commit?.runIds.length ?? 0} executions · all branches
                    remain visible.
                  </span>
                  <button
                    onClick={() => {
                      setFocusedBranch(null);
                      setFocusedCommit(null);
                    }}
                  >
                    Clear highlight
                  </button>
                </>
              ) : (
                <span>
                  Select a branch or update to highlight its context in the case
                  patterns below.
                </span>
              )}
            </div>
          </section>
          <section className={styles.signals} aria-label="Skill-wide insights">
            <button
              className="panel"
              onClick={() => signalFocus("recurring")}
              disabled={!recurring}
            >
              <span>Most recurring failure during period</span>
              <strong>
                {recurring
                  ? `${recurring.failed} / ${recurring.executions} runs`
                  : matching
                    ? "No failed verdicts"
                    : "No comparable results"}
              </strong>
              <small>
                {recurring
                  ? `${recurring.label} · ${recurring.affectedBranches} affected branches`
                  : "Based on recorded cases in the analysis configuration."}
              </small>
            </button>
            <button
              className="panel"
              onClick={() => signalFocus("inconsistent")}
              disabled={!data.signals.inconsistentUpdates}
            >
              <span>Inconsistent repeat runs</span>
              <strong>
                {data.signals.inconsistentUpdates} update
                {data.signals.inconsistentUpdates === 1 ? "" : "s"}
              </strong>
              <small>
                Passed and failed outcomes at the same recorded SHA and
                configuration.
              </small>
            </button>
            <button
              className="panel"
              onClick={() => signalFocus("coverage")}
              disabled={!data.signals.coverageGapBranchKeys.length}
            >
              <span>Fewer cases tested</span>
              <strong>
                {data.signals.coverageGapBranchKeys.length} branch
                {data.signals.coverageGapBranchKeys.length === 1 ? "" : "es"}
              </strong>
              <small>
                Latest case set is smaller than an earlier recorded set. This
                may be an intentional subset.
              </small>
            </button>
          </section>
          <section className="panel" aria-label="Case patterns across branches">
            <div className="panel-heading">
              <div>
                <h2>Case patterns across branches</h2>
                <p>
                  Shared weak spots, isolated failures, and gaps in evidence.
                </p>
              </div>
              <span className="result-count">{filtered.length} cases</span>
            </div>
            <div className={styles.patternControls}>
              <label>
                View
                <select
                  aria-label="Case pattern view"
                  value={view}
                  onChange={(event) =>
                    setView(event.target.value as CasePatternView)
                  }
                >
                  <option value="latest">Latest result per branch</option>
                  <option value="period">Failure frequency</option>
                </select>
              </label>
              <label>
                Cases
                <select
                  aria-label="Case pattern filter"
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as CasePatternFilter)
                  }
                >
                  <option value="failed">With failures</option>
                  <option value="recurring">Across multiple branches</option>
                  <option value="all">All cases</option>
                </select>
              </label>
              <span>
                {focus ? `Highlight: ${focus.label}` : "All branches"}
              </span>
            </div>
            <div className={`table-wrap ${styles.matrix}`}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      Case /{" "}
                      {view === "period"
                        ? "period-wide pattern"
                        : "latest failure spread"}
                    </th>
                    {data.branches.map((branch) => (
                      <th
                        scope="col"
                        key={branch.key}
                        className={
                          branch.key === focusedBranch
                            ? styles.focusedColumn
                            : undefined
                        }
                      >
                        <button
                          className={styles.columnName}
                          onClick={() => focusBranch(branch)}
                        >
                          {branch.label}
                        </button>
                        {view === "latest" && !branch.latestContextMatch && (
                          <small>Different / incomplete settings †</small>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleCases.map((item) => (
                    <tr
                      key={item.key}
                      className={`clickable-row ${inspected?.key === item.key ? styles.selectedCase : ""}`}
                      tabIndex={0}
                      aria-label={`Inspect case pattern ${item.label}`}
                      onClick={() => setSelectedCase(item.key)}
                      onKeyDown={(event) =>
                        activateRow(event, () => setSelectedCase(item.key))
                      }
                    >
                      <th scope="row">
                        <button
                          className={styles.caseName}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedCase(item.key);
                          }}
                        >
                          {item.label}
                        </button>
                        {item.testType && <small>{item.testType}</small>}
                        <small>
                          {view === "period"
                            ? `${item.failed}/${item.executions} failed · ${item.affectedBranches} affected branches`
                            : `${patternFailureCount(item, view)} branches currently failing`}
                        </small>
                      </th>
                      {item.cells.map((cell) => (
                        <PatternCell
                          key={cell.branchKey}
                          cell={cell}
                          view={view}
                          focused={cell.branchKey === focusedBranch}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="empty" role="status">
                <strong>No cases match this view and filter.</strong>
                <button
                  className="secondary-button"
                  onClick={() => setFilter("all")}
                >
                  Show all cases
                </button>
              </div>
            )}
            {filtered.length > 25 && (
              <div className="trend-pagination">
                <span>
                  {currentCasePage * 25 + 1}–
                  {Math.min((currentCasePage + 1) * 25, filtered.length)} of{" "}
                  {filtered.length}
                </span>
                <nav aria-label="Case pattern pages">
                  <button
                    disabled={!currentCasePage}
                    onClick={() =>
                      setCasePagination({
                        key: pageKey,
                        page: currentCasePage - 1,
                      })
                    }
                  >
                    Previous
                  </button>
                  <button
                    disabled={(currentCasePage + 1) * 25 >= filtered.length}
                    onClick={() =>
                      setCasePagination({
                        key: pageKey,
                        page: currentCasePage + 1,
                      })
                    }
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}
            <div className={styles.legend}>
              {view === "period"
                ? "Each cell: failed executions / executions where the case ran, within the analysis configuration. Darker tint means more frequent failure."
                : "Latest observed case verdict on each branch. Not run means the case was absent; Unavailable means its case records are incomplete. † Settings differ from the frequency analysis."}
            </div>
            {inspected && (
              <CaseEvidence
                item={inspected}
                branches={data.branches}
                view={view}
              />
            )}
            <div className={styles.legend}>
              {matching
                ? `${matching.runCount} matching executions · ${matching.caseCount} case identities · ${data.signals.excludedRuns} completed executions in other recorded configurations.`
                : "No completed executions with complete case records are available for frequency analysis."}
              {matching &&
                !matching.configurationComplete &&
                " Scope, runtime, or metric configuration is incomplete; branch improvement and rerun signals require fuller metadata."}
              {data.signals.incompleteCaseRuns > 0 &&
                ` ${data.signals.incompleteCaseRuns} completed runs have incomplete case records.`}
              {data.signals.operationalRuns > 0 &&
                ` ${data.signals.operationalRuns} blocked/error runs remain in supporting history and are excluded from completed-case frequency analysis.`}
            </div>
          </section>
          <SupportingRunHistory
            runs={data.runs}
            openingRunId={openingRunId}
            onOpenRun={onOpenRun}
          />
        </>
      )}
    </>
  );
}

function BranchDirection({ branch }: { branch: HistoryBranch }) {
  const labels = {
    improved: "Improved",
    declined: "Declined",
    unchanged: "Unchanged",
    insufficient: "More evidence needed",
    context_changed: "Settings changed",
  };
  return (
    <div className={styles.direction}>
      <strong
        className={
          branch.direction === "improved"
            ? styles.good
            : branch.direction === "declined"
              ? styles.bad
              : undefined
        }
      >
        {labels[branch.direction]}
      </strong>
      <small>
        {branch.direction === "context_changed"
          ? "Case set or recorded configuration changed"
          : branch.direction === "insufficient"
            ? "Distinct comparable updates are needed"
            : `${rateLabel(branch.firstPassRate)} → ${rateLabel(branch.latestPassRate)}`}
      </small>
      {branch.inconsistentLatest && <small>Latest update: reruns vary</small>}
      {branch.fewerCases && (
        <small>
          {branch.coverageActual}/{branch.coverageExpected} earlier cases tested
        </small>
      )}
    </div>
  );
}

function PatternCell({
  cell,
  view,
  focused,
}: {
  cell: HistoryCaseCell;
  view: CasePatternView;
  focused: boolean;
}) {
  const failures =
    view === "period" ? cell.failed : Number(cell.latestState === "failed");
  const style =
    view === "period" && cell.executions && failures
      ? ({
          "--failure-tint": `${Math.round(5 + (13 * failures) / cell.executions)}%`,
        } as CSSProperties)
      : undefined;
  const tone = failures
    ? styles.failureCell
    : view === "latest" && cell.latestState === "passed"
      ? styles.passCell
      : styles.neutralCell;
  return (
    <td className={focused ? styles.focusedColumn : undefined}>
      <span
        className={`${styles.cell} ${tone}`}
        style={style}
        title={caseCellContext(cell, view)}
      >
        {caseCellLabel(cell, view)}
        {view === "latest" && !cell.latestContextMatch ? " †" : ""}
      </span>
      {view === "period" && cell.blocked > 0 && (
        <small>{cell.blocked} blocked/error</small>
      )}
    </td>
  );
}

function CaseEvidence({
  item,
  branches,
  view,
}: {
  item: HistoryCase;
  branches: HistoryBranch[];
  view: CasePatternView;
}) {
  const latestFailed = item.cells.filter(
    (cell) => cell.latestState === "failed",
  );
  return (
    <div className={styles.caseEvidence} aria-live="polite">
      <strong>{item.label}</strong>
      <p>
        {view === "period"
          ? `${item.failed} failed verdicts in ${item.executions} matching executions across ${item.affectedBranches} affected branches.`
          : `${latestFailed.length} branches failed this case in their latest observed execution.`}
      </p>
      <div>
        <span>
          First failure in analysis:{" "}
          {item.firstFailedAt
            ? historyTime(item.firstFailedAt)
            : "None recorded"}
        </span>
        <span>
          Most recent:{" "}
          {item.lastFailedAt ? historyTime(item.lastFailedAt) : "None recorded"}
        </span>
        <span>
          {item.inconsistentUpdates} recorded updates with inconsistent repeat
          outcomes
        </span>
      </div>
      {view === "latest" && latestFailed.length > 0 && (
        <p>
          Latest failures:{" "}
          {latestFailed
            .map(
              (cell) =>
                `${branches.find((branch) => branch.key === cell.branchKey)?.label ?? "Unknown branch"}${cell.latestContextMatch ? "" : " †"}`,
            )
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}

function SupportingRunHistory({
  runs,
  openingRunId,
  onOpenRun,
}: {
  runs: HistoryRun[];
  openingRunId: string | null;
  onOpenRun: Props["onOpenRun"];
}) {
  const [size, setSize] = useState(25);
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
                    {run.gitSha?.slice(0, 7) ?? "SHA not recorded"}
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
                    {run.executionStatus === "completed" &&
                    run.passed !== null &&
                    run.total !== null
                      ? `${run.passed}/${run.total} passed`
                      : run.executionStatus}
                  </strong>
                  <small>{run.verdict}</small>
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
