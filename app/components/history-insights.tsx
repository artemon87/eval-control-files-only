"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import type { EvalApi } from "../lib/eval-api";
import type { EvalType } from "../lib/eval-types";

import {
  cellKey,
  runContext,
  type InsightsRun,
  type InsightsResponse,
  type Landscape,
  type TestMatrix,
  type CellState,
  type Insight,
  type Observation,
  type TestBranchCell,
} from "../lib/history-insights";
import styles from "./history-insights.module.css";
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

const PROBLEM_FILTER_THRESHOLD = 25;
const ROW_HEADER_KEY = "\u0000rows",
  DEFAULT_BRANCH_WIDTH = 84,
  DEFAULT_ROW_HEADER_WIDTH = 260;
const COLUMN_LIMITS = { min: 64, max: 520 },
  ROW_HEADER_LIMITS = { min: 160, max: 640 },
  BRANCH_SEARCH_THRESHOLD = 8;
type InsightRange = "7d" | "30d" | "90d";
export type HistoryInsightsFocus = {
  type: EvalType;
  scope?: string;
  category?: string;
  stage?: string;
  targetEnvironment?: string;
} | null;
const CELL_GLYPH: Record<CellState, string> = {
  pass: "✓",
  fail: "×",
  regression: "▼",
  fixed: "▲",
  flaky: "≈",
  missing: "·",
};
const CELL_LABEL: Record<CellState, string> = {
  pass: "Passing",
  fail: "Failing (baseline fails or is flaky)",
  regression: "Regression vs baseline",
  fixed: "Fixed vs baseline",
  flaky: "Flaky",
  missing: "Not run",
};
const OUTCOME_GLYPH: Record<Observation["outcome"], string> = {
  pass: "✓",
  fail: "×",
  error: "!",
  skip: "−",
};
function passRateTone(passRate: number) {
  if (passRate >= 95) return styles.heatGreat;
  if (passRate >= 80) return styles.heatGood;
  if (passRate >= 60) return styles.heatWarn;
  return styles.heatBad;
}
function formatDelta(delta: number) {
  return `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta).toFixed(0)}`;
}
type LoadedInsights = {
  key: string;
  data: InsightsResponse | null;
  error: string | null;
};
type SelectedCell = { testKey: string; branch: string };
export type HistoryInsightsSnapshot = {
  evalType: EvalType;
  range: InsightRange;
  reloadKey: number;
  loaded: LoadedInsights;
  windowEnd?: string;
  repository: string;
  category: string | null;
  stage: string | null;
  targetEnvironment: string;
  baselineOverride: string | null;
  scope: string | null;
  focusBranch: string | null;
  focusTest: string | null;
  selectedCell: SelectedCell | null;
  problemsOnly: boolean | null;
  testSearch: string;
  columnWidths: Record<string, number>;
  hiddenBranches: string[];
  scrollY: number;
};
type TableLayout = {
  widths: Record<string, number>;
  hidden: string[];
  onWidth: (key: string, width: number | null) => void;
  onHidden: (hidden: string[]) => void;
};
function clampWidth(width: number, limits: { min: number; max: number }) {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}
function fixedWidth(width: number): CSSProperties {
  return { width, minWidth: width, maxWidth: width };
}
export function HistoryInsights({
  api,
  initialFocus,
  snapshot,
  onSnapshot,
  openingRunId,
  onOpenRun,
}: {
  api: EvalApi | null;
  initialFocus: HistoryInsightsFocus;
  snapshot: HistoryInsightsSnapshot | null;
  onSnapshot: (snapshot: HistoryInsightsSnapshot) => void;
  openingRunId: string | null;
  onOpenRun: (runId: string, evalType: EvalType) => void;
}) {
  const [evalType, setEvalType] = useState<EvalType>(
    snapshot?.evalType ?? initialFocus?.type ?? "unit",
  );
  const [range, setRange] = useState<InsightRange>(snapshot?.range ?? "30d"),
    [reloadKey, setReloadKey] = useState(snapshot?.reloadKey ?? 0);
  const [loaded, setLoaded] = useState<LoadedInsights>(
    snapshot?.loaded ?? { key: "", data: null, error: null },
  );
  const [repository, setRepository] = useState(snapshot?.repository ?? "all");
  const [category, setCategory] = useState<string | null>(
    snapshot
      ? snapshot.category
      : initialFocus?.type === "unit"
        ? (initialFocus.category ?? null)
        : null,
  );
  const [stage, setStage] = useState<string | null>(
    snapshot ? snapshot.stage : (initialFocus?.stage ?? null),
  );
  const [targetEnvironment, setTargetEnvironment] = useState(
    snapshot?.targetEnvironment ?? initialFocus?.targetEnvironment ?? "all",
  );
  const [baselineOverride, setBaselineOverride] = useState<string | null>(
    snapshot?.baselineOverride ?? null,
  );
  const [scope, setScope] = useState<string | null>(
    snapshot ? snapshot.scope : (initialFocus?.scope ?? null),
  );
  const [focusBranch, setFocusBranch] = useState<string | null>(
      snapshot?.focusBranch ?? null,
    ),
    [focusTest, setFocusTest] = useState<string | null>(
      snapshot?.focusTest ?? null,
    );
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(
    snapshot?.selectedCell ?? null,
  );
  const [problemsOnly, setProblemsOnly] = useState<boolean | null>(
      snapshot?.problemsOnly ?? null,
    ),
    [testSearch, setTestSearch] = useState(snapshot?.testSearch ?? "");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
      snapshot?.columnWidths ?? {},
    ),
    [hiddenBranches, setHiddenBranches] = useState<string[]>(
      snapshot?.hiddenBranches ?? [],
    );
  const [windowEnd, setWindowEnd] = useState<string | undefined>(
    snapshot?.windowEnd,
  );
  const anchorRef = useRef(windowEnd);
  const scrollY = useRef(snapshot?.scrollY ?? 0),
    scrollFrozen = useRef(false),
    latest = useRef<HistoryInsightsSnapshot | null>(null);
  useEffect(() => {
    latest.current = {
      evalType,
      range,
      reloadKey,
      loaded,
      repository,
      category,
      stage,
      targetEnvironment,
      baselineOverride,
      scope,
      focusBranch,
      focusTest,
      selectedCell,
      windowEnd,
      problemsOnly,
      testSearch,
      columnWidths,
      hiddenBranches,
      scrollY: scrollY.current,
    };
  });
  useEffect(() => {
    const restoreTo = snapshot?.scrollY ?? 0;
    const frame = restoreTo
      ? window.requestAnimationFrame(() => window.scrollTo(0, restoreTo))
      : 0;
    const track = () => {
      if (!scrollFrozen.current) scrollY.current = window.scrollY;
    };
    window.addEventListener("scroll", track, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", track);
      if (latest.current)
        onSnapshot({ ...latest.current, scrollY: scrollY.current });
    };
    // Restore once on mount and save once on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!openingRunId) scrollFrozen.current = false;
  }, [openingRunId]);
  const openRun = (runId: string) => {
    scrollY.current = window.scrollY;
    scrollFrozen.current = true;
    onOpenRun(runId, evalType);
  };
  const requestKey = JSON.stringify([
    evalType,
    range,
    reloadKey,
    repository,
    category,
    stage,
    targetEnvironment,
    scope,
    baselineOverride,
  ]);
  const alreadyLoaded = loaded.key === requestKey;
  useEffect(() => {
    if (!api || alreadyLoaded) return;
    const controller = new AbortController();
    void api
      .getEvaluationInsights(
        {
          evalType,
          range,
          repository,
          category,
          stage,
          targetEnvironment,
          scope,
          baseline: baselineOverride,
          windowEnd: anchorRef.current,
        },
        controller.signal,
      )
      .then((data) => {
        if (controller.signal.aborted) return;
        anchorRef.current = data.window.startedBefore;
        setWindowEnd(data.window.startedBefore);
        setLoaded({ key: requestKey, data, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            data: null,
            error:
              reason instanceof Error
                ? reason.message
                : "Unable to load insights",
          });
      });
    return () => controller.abort();
  }, [
    api,
    alreadyLoaded,
    requestKey,
    evalType,
    range,
    repository,
    category,
    stage,
    targetEnvironment,
    scope,
    baselineOverride,
  ]);
  const loading = loaded.key !== requestKey;
  const data = loaded.data;
  const error = loaded.error;
  const {
    repositories = [],
    categories = [],
    scopeOptions = [],
    stageOptions = [],
    targetOptions = [],
    branchNames = [],
    activeCategory = "all",
    activeStage = "all",
    activeTarget = "all",
    activeScope = null,
    baseline = null,
    mixedStages = 1,
    mixedTargets = 1,
    regressionPoints = 5,
  } = data ?? {};
  const landscape: Landscape = data?.landscape ?? {
    scopes: [],
    branches: [],
    cells: new Map(),
    insights: [],
  };
  const matrix = data?.matrix ?? null;
  const counts = data?.counts ?? {
    runCount: 0,
    scopeCount: 0,
    branchCount: 0,
    regressedCells: 0,
    systemicScopes: 0,
    caseRunCount: 0,
    testsTracked: 0,
    bottleneckTests: 0,
    branchRegressions: 0,
    flakyTests: 0,
  };
  const resetFocus = () => {
    setFocusBranch(null);
    setFocusTest(null);
    setSelectedCell(null);
  };
  const openScope = (next: string | null, branch: string | null = null) => {
    setScope(next);
    setFocusTest(null);
    setSelectedCell(null);
    setFocusBranch(branch);
    setTestSearch("");
  };
  const switchType = (next: EvalType) => {
    if (next === evalType) return;
    setEvalType(next);
    setRepository("all");
    setCategory(null);
    setStage(null);
    setTargetEnvironment("all");
    setBaselineOverride(null);
    openScope(null);
  };
  const applyInsight = (insight: Insight) => {
    if (!activeScope && insight.scope) {
      openScope(insight.scope, insight.branch ?? null);
      return;
    }
    setFocusBranch(insight.branch ?? null);
    setFocusTest(insight.testKey ?? null);
    if (insight.testKey)
      document
        .getElementById(`insight-test-${encodeURIComponent(insight.testKey)}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const noun = evalType === "unit" ? "skill" : "target";
  const tableLayout: TableLayout = {
    widths: columnWidths,
    hidden: hiddenBranches,
    onWidth: (key, width) =>
      setColumnWidths((current) => {
        const next = { ...current };
        if (width === null) delete next[key];
        else next[key] = width;
        return next;
      }),
    onHidden: setHiddenBranches,
  };
  const insights = matrix ? matrix.insights : landscape.insights;
  return (
    <div className={styles.page}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Skill intelligence</span>
          <h1>Evaluation insights</h1>
          <p>
            Which branches moved each {noun}, which tests hold it back, and
            where to look first.
          </p>
        </div>
        <div className="type-switch">
          <button
            className={evalType === "unit" ? "active" : ""}
            onClick={() => switchType("unit")}
          >
            Unit skills
          </button>
          <button
            className={evalType === "e2e" ? "active" : ""}
            onClick={() => switchType("e2e")}
          >
            E2E targets
          </button>
        </div>
      </div>
      <section className={`panel ${styles.controls}`}>
        {repositories.length > 1 && (
          <label>
            <span>Repository</span>
            <select
              aria-label="Insights repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
            >
              <option value="all">All repositories</option>
              {repositories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {evalType === "unit" && (
          <label>
            <span>Category</span>
            <select
              aria-label="Insights category"
              value={activeCategory}
              onChange={(event) => {
                setCategory(event.target.value);
                setStage("all");
                setTargetEnvironment("all");
                openScope(null);
              }}
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {evalType === "e2e" && (
          <label>
            <span>Stage</span>
            <select
              aria-label="Insights E2E stage"
              value={activeStage ?? ""}
              onChange={(event) => {
                setStage(event.target.value);
                openScope(null);
              }}
            >
              {stageOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{evalType === "unit" ? "Skill" : "Target"}</span>
          <select
            aria-label={`Insights ${noun}`}
            value={activeScope ?? "all"}
            onChange={(event) =>
              openScope(
                event.target.value === "all" ? null : event.target.value,
              )
            }
          >
            <option value="all">All {noun}s · heatmap</option>
            {scopeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {evalType === "unit" && (
          <>
            <label>
              <span>Stage</span>
              <select
                aria-label="Insights stage"
                value={activeStage ?? "all"}
                onChange={(event) => {
                  setStage(event.target.value);
                  setTargetEnvironment("all");
                }}
              >
                <option value="all">All stages</option>
                {stageOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target environment</span>
              <select
                aria-label="Insights target environment"
                value={activeTarget}
                onChange={(event) => setTargetEnvironment(event.target.value)}
              >
                <option value="all">All targets</option>
                {targetOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          <span>Baseline branch</span>
          <select
            aria-label="Insights baseline branch"
            value={baseline ?? ""}
            onChange={(event) => setBaselineOverride(event.target.value)}
            disabled={!branchNames.length}
          >
            {branchNames.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.controlMeta}>
          <div className={styles.controlStatus}>
            {!api
              ? "API not configured"
              : loading
                ? "Loading runs…"
                : `${counts.runCount} runs · ${branchNames.length} branches · ${counts.scopeCount} ${noun}s`}
          </div>
          <div className="range-switch">
            {(["7d", "30d", "90d"] as const).map((value) => (
              <button
                key={value}
                className={range === value ? "active" : ""}
                onClick={() => setRange(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.refresh}
            onClick={() => {
              anchorRef.current = undefined;
              setWindowEnd(undefined);
              setReloadKey((key) => key + 1);
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </section>
      <nav className={styles.breadcrumb} aria-label="Insights scope">
        <button type="button" onClick={() => openScope(null)}>
          {evalType === "unit"
            ? activeCategory === "all"
              ? "All categories"
              : activeCategory
            : (activeStage ?? "All stages")}
        </button>
        {evalType === "unit" && activeStage && activeStage !== "all" && (
          <>
            <span>›</span>
            <span>{activeStage}</span>
          </>
        )}
        {activeTarget !== "all" && (
          <>
            <span>›</span>
            <span>{activeTarget}</span>
          </>
        )}
        {activeScope && (
          <>
            <span>›</span>
            <strong>{activeScope}</strong>
          </>
        )}
        {(mixedStages > 1 || mixedTargets > 1) && (
          <span className={styles.mixedScope}>
            Mixing{" "}
            {[
              mixedStages > 1 ? `${mixedStages} stages` : "",
              mixedTargets > 1 ? `${mixedTargets} target environments` : "",
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            · Each cell uses its latest run, whichever stage or target that was.
            Pick one for a like-for-like comparison.
          </span>
        )}
        {(focusBranch || focusTest) && (
          <button
            type="button"
            className={styles.clearFocus}
            onClick={resetFocus}
          >
            Clear highlight
          </button>
        )}
      </nav>
      {!api && (
        <div className={`panel ${styles.empty}`}>
          <strong>Connect the evaluation API to load insights</strong>
        </div>
      )}
      {loading && api && (
        <div className="panel" role="status">
          Loading insights…
        </div>
      )}
      {error && !loading && (
        <div className={`panel ${styles.empty}`}>
          <strong>Unable to load runs</strong>
          <span>{error}</span>
        </div>
      )}
      {!error && !loading && !counts.runCount && (
        <div className={`panel ${styles.empty}`}>
          <strong>
            No completed {evalType === "unit" ? "unit" : "E2E"} runs in the last{" "}
            {range}
          </strong>
          <span>Widen the window or switch evaluation type.</span>
        </div>
      )}
      {!error && !loading && counts.runCount > 0 && (
        <>
          <section className={styles.kpis}>
            {matrix ? (
              <>
                <Kpi
                  label="Tests tracked"
                  value={counts.testsTracked}
                  detail={`${counts.caseRunCount} runs analysed`}
                />
                <Kpi
                  label="Bottleneck tests"
                  value={counts.bottleneckTests}
                  detail="fail on most branches"
                  tone="bad"
                />
                <Kpi
                  label="Branch regressions"
                  value={counts.branchRegressions}
                  detail={`tests passing on ${baseline} but failing elsewhere`}
                  tone="bad"
                />
                <Kpi
                  label="Flaky tests"
                  value={counts.flakyTests}
                  detail="flip on the same branch"
                  tone="warn"
                />
              </>
            ) : (
              <>
                <Kpi
                  label="Active branches"
                  value={counts.branchCount}
                  detail={`baseline: ${baseline ?? "—"}`}
                />
                <Kpi
                  label={`${noun[0].toUpperCase()}${noun.slice(1)}s tracked`}
                  value={landscape.scopes.length}
                  detail={`${counts.runCount} runs in ${range}`}
                />
                <Kpi
                  label="Regressions vs baseline"
                  value={counts.regressedCells}
                  detail={`${noun} × branch cells ≥${regressionPoints} pts below`}
                  tone="bad"
                />
                <Kpi
                  label="Failing everywhere"
                  value={counts.systemicScopes}
                  detail={`${noun}s failing on every branch`}
                  tone="warn"
                />
              </>
            )}
          </section>
          <section className={`panel ${styles.insightsPanel}`}>
            <div className="panel-heading">
              <div>
                <h2>What stands out</h2>
                <p>
                  Ranked by severity. Click one to highlight it{" "}
                  {activeScope ? "in the matrix" : "or open its deep dive"}.
                </p>
              </div>
            </div>
            {insights.length ? (
              <div className={styles.insightGrid}>
                {insights.slice(0, 8).map((insight) => (
                  <button
                    key={insight.id}
                    type="button"
                    className={`${styles.insight} ${styles[`insight_${insight.severity}`]}`}
                    onClick={() => applyInsight(insight)}
                  >
                    <span className={styles.insightKind}>
                      {insight.kind.replaceAll("-", " ")}
                    </span>
                    <strong>{insight.title}</strong>
                    <small>{insight.detail}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.quiet}>
                Nothing unusual. Every branch matches the baseline in this
                window.
              </p>
            )}
          </section>
          {matrix ? (
            <TestMatrixPanel
              matrix={matrix}
              baseline={baseline}
              evalType={evalType}
              loadingCases={0}
              caseErrors={0}
              loadedCaseRuns={counts.caseRunCount}
              totalCaseRuns={counts.caseRunCount}
              focusBranch={focusBranch}
              focusTest={focusTest}
              selectedCell={selectedCell}
              onSelectCell={setSelectedCell}
              problemsOnly={
                problemsOnly ?? matrix.tests.length > PROBLEM_FILTER_THRESHOLD
              }
              onProblemsOnly={setProblemsOnly}
              search={testSearch}
              onSearch={setTestSearch}
              openingRunId={openingRunId}
              onOpenRun={openRun}
              layout={tableLayout}
            />
          ) : (
            <div className={styles.landscapeLayout}>
              <LandscapePanel
                landscape={landscape}
                regressionPoints={regressionPoints}
                baseline={baseline}
                noun={noun}
                focusBranch={focusBranch}
                onOpenScope={openScope}
                layout={tableLayout}
              />
              <BlastRadiusPanel
                landscape={landscape}
                baseline={baseline}
                noun={noun}
                focusBranch={focusBranch}
                onFocusBranch={setFocusBranch}
                hidden={hiddenBranches}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "bad" | "warn";
}) {
  return (
    <article
      className={`panel ${styles.kpi} ${value > 0 && tone ? styles[`kpi_${tone}`] : ""}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function LandscapePanel({
  landscape,
  regressionPoints,
  baseline,
  noun,
  focusBranch,
  onOpenScope,
  layout,
}: {
  landscape: Landscape;
  regressionPoints: number;
  baseline: string | null;
  noun: string;
  focusBranch: string | null;
  onOpenScope: (scope: string, branch?: string | null) => void;
  layout: TableLayout;
}) {
  const tableRef = useRef<HTMLTableElement>(null),
    columns = landscape.branches.filter(
      (column) => column.isBaseline || !layout.hidden.includes(column.branch),
    ),
    rowHeaderWidth = layout.widths[ROW_HEADER_KEY] ?? DEFAULT_ROW_HEADER_WIDTH;
  return (
    <section className={`panel ${styles.matrixPanel}`}>
      <div className="panel-heading">
        <div>
          <h2>{noun[0].toUpperCase() + noun.slice(1)} × branch heatmap</h2>
          <p>
            Latest pass rate per branch. Outlined cells are ≥{regressionPoints}{" "}
            points below {baseline ?? "the baseline"}. Click a row or cell to
            see the tests behind it.
          </p>
        </div>
        <TableTools
          tableRef={tableRef}
          layout={layout}
          branches={landscape.branches.map((column) => ({
            branch: column.branch,
            isBaseline: column.isBaseline,
            detail: column.scopesRegressed
              ? `▼${column.scopesRegressed} ${noun}${column.scopesRegressed === 1 ? "" : "s"}`
              : `${column.runCount} runs`,
          }))}
        />
      </div>
      <div className={styles.legendRow}>
        <HeatLegend />
      </div>
      <div className={styles.matrixScroll}>
        <table
          className={styles.matrix}
          ref={tableRef}
          style={
            { "--row-header-width": `${rowHeaderWidth}px` } as CSSProperties
          }
        >
          <thead>
            <tr>
              <RowHeaderCell layout={layout}>{noun}</RowHeaderCell>
              {columns.map((column) => (
                <BranchHeaderCell
                  key={column.branch}
                  branch={column.branch}
                  isBaseline={column.isBaseline}
                  focused={focusBranch === column.branch}
                  layout={layout}
                  title={column.branch}
                  detail={
                    column.isBaseline
                      ? "baseline"
                      : column.scopesRegressed
                        ? `▼${column.scopesRegressed}`
                        : `${column.runCount} runs`
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {landscape.scopes.map((row) => (
              <tr key={row.scope}>
                <th scope="row" className={styles.rowHeader}>
                  <button type="button" onClick={() => onOpenScope(row.scope)}>
                    <strong>{row.scope}</strong>
                    <small>
                      {row.systemic
                        ? "failing on every branch"
                        : row.branchesRegressed
                          ? `regressed on ${row.branchesRegressed} branch${row.branchesRegressed === 1 ? "" : "es"}`
                          : `${row.runCount} runs`}
                    </small>
                  </button>
                </th>
                {columns.map((column) => {
                  const cell = landscape.cells.get(
                      cellKey(row.scope, column.branch),
                    ),
                    columnClass = `${column.isBaseline ? styles.baselineColumn : ""} ${focusBranch === column.branch ? styles.focusColumn : ""}`;
                  return (
                    <td key={column.branch} className={columnClass}>
                      {cell ? (
                        <button
                          type="button"
                          className={`${styles.heatCell} ${passRateTone(cell.latestPassRate)} ${cell.regressed ? styles.heatRegressed : ""} ${cell.improved ? styles.heatImproved : ""}`}
                          onClick={() => onOpenScope(row.scope, column.branch)}
                          title={`${row.scope} on ${column.branch}\nLatest ${cell.latestPassRate.toFixed(1)}% · ${formatTime(cell.latest.startedAt)}\n${runContext(cell.latest)}\n${cell.runs.length} run(s), mean ${cell.meanPassRate.toFixed(1)}%${cell.latest.gitSha ? `\n${cell.latest.gitSha.slice(0, 7)}` : ""}${cell.deltaVsBaseline !== null ? `\n${formatDelta(cell.deltaVsBaseline)} pts vs ${baseline}` : ""}`}
                        >
                          <b>{cell.latestPassRate.toFixed(0)}%</b>
                          {cell.deltaVsBaseline !== null &&
                            Math.abs(cell.deltaVsBaseline) >= 1 && (
                              <small>
                                {cell.regressed
                                  ? "▼"
                                  : cell.improved
                                    ? "▲"
                                    : ""}
                                {formatDelta(cell.deltaVsBaseline)}
                              </small>
                            )}
                          <RunStrip runs={cell.runs} />
                        </button>
                      ) : (
                        <span
                          className={`${styles.heatCell} ${styles.heatEmpty}`}
                          aria-label={`${row.scope} not run on ${column.branch}`}
                        >
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function RowHeaderCell({
  layout,
  children,
}: {
  layout: TableLayout;
  children: ReactNode;
}) {
  return (
    <th className={`${styles.rowHeader} ${styles.resizable}`} scope="col">
      <span data-fit>{children}</span>
      <ColumnResizer
        label="Resize name column"
        limits={ROW_HEADER_LIMITS}
        onResize={(width) => layout.onWidth(ROW_HEADER_KEY, width)}
      />
    </th>
  );
}
function BranchHeaderCell({
  branch,
  isBaseline,
  focused,
  layout,
  title,
  detail,
}: {
  branch: string;
  isBaseline: boolean;
  focused: boolean;
  layout: TableLayout;
  title: string;
  detail: string;
}) {
  const width = layout.widths[branch] ?? DEFAULT_BRANCH_WIDTH;
  return (
    <th
      scope="col"
      data-branch={branch}
      className={`${styles.branchHeader} ${styles.resizable} ${isBaseline ? styles.baselineColumn : ""} ${focused ? styles.focusColumn : ""}`}
      style={fixedWidth(width)}
      title={title}
    >
      <span data-fit>{branch}</span>
      <small>{detail}</small>
      {!isBaseline && (
        <button
          type="button"
          className={styles.hideBranch}
          aria-label={`Hide ${branch}`}
          title={`Hide ${branch}`}
          onClick={() => layout.onHidden([...layout.hidden, branch])}
        >
          ×
        </button>
      )}
      <ColumnResizer
        label={`Resize ${branch} column`}
        limits={COLUMN_LIMITS}
        onResize={(next) => layout.onWidth(branch, next)}
      />
    </th>
  );
}
function ColumnResizer({
  label,
  limits,
  onResize,
}: {
  label: string;
  limits: { min: number; max: number };
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const headerWidth = (element: HTMLElement) =>
    element.closest("th")?.getBoundingClientRect().width ?? limits.min;
  const fitWidth = (element: HTMLElement) => {
    const name = element
      .closest("th")
      ?.querySelector<HTMLElement>("[data-fit]");
    return name ? name.scrollWidth + 28 : headerWidth(element);
  };
  const stop = (event: ReactPointerEvent<HTMLSpanElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={styles.resizer}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width: headerWidth(event.currentTarget),
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onResize(
          clampWidth(
            drag.current.width + event.clientX - drag.current.x,
            limits,
          ),
        );
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={(event) =>
        onResize(clampWidth(fitWidth(event.currentTarget), limits))
      }
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? -16 : 16;
        onResize(clampWidth(headerWidth(event.currentTarget) + step, limits));
      }}
    />
  );
}
type BranchOption = { branch: string; isBaseline: boolean; detail: string };
function TableTools({
  tableRef,
  layout,
  branches,
}: {
  tableRef: RefObject<HTMLTableElement | null>;
  layout: TableLayout;
  branches: BranchOption[];
}) {
  const resized = Object.keys(layout.widths).length > 0;
  const fitNames = () =>
    tableRef.current
      ?.querySelectorAll<HTMLElement>("th[data-branch]")
      .forEach((header) => {
        const name = header.querySelector<HTMLElement>("[data-fit]");
        if (name && header.dataset.branch)
          layout.onWidth(
            header.dataset.branch,
            clampWidth(name.scrollWidth + 28, COLUMN_LIMITS),
          );
      });
  return (
    <div className={styles.tableTools}>
      <BranchPicker
        branches={branches}
        hidden={layout.hidden}
        onChange={layout.onHidden}
      />
      <button type="button" className={styles.toolButton} onClick={fitNames}>
        ↔ Fit names
      </button>
      {resized && (
        <button
          type="button"
          className={styles.toolButton}
          onClick={() =>
            Object.keys(layout.widths).forEach((key) =>
              layout.onWidth(key, null),
            )
          }
        >
          Reset widths
        </button>
      )}
    </div>
  );
}
function BranchPicker({
  branches,
  hidden,
  onChange,
}: {
  branches: BranchOption[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null);
  const hiddenHere = branches.filter(
      (option) => !option.isBaseline && hidden.includes(option.branch),
    ),
    visibleCount = branches.length - hiddenHere.length,
    needle = query.trim().toLowerCase(),
    listed = needle
      ? branches.filter((option) =>
          option.branch.toLowerCase().includes(needle),
        )
      : branches;
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
  const toggle = (branch: string) =>
    onChange(
      hidden.includes(branch)
        ? hidden.filter((item) => item !== branch)
        : [...hidden, branch],
    );
  return (
    <div
      className={`stage-multiselect ${styles.branchPicker}${open ? " open" : ""}`}
      ref={pickerRef}
    >
      <button
        type="button"
        className="stage-multiselect-trigger"
        aria-label="Choose branches"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
      >
        <span>
          {hiddenHere.length
            ? `${visibleCount} of ${branches.length} branches`
            : "All branches"}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className={`stage-multiselect-menu ${styles.branchMenu}`}
          role="dialog"
          aria-label="Choose branches"
        >
          <div className="stage-multiselect-heading">
            <strong>Branches in table</strong>
            <span>{branches.length} available</span>
          </div>
          {branches.length > BRANCH_SEARCH_THRESHOLD && (
            <input
              type="search"
              className={styles.branchSearch}
              placeholder="Find a branch"
              aria-label="Find a branch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <label>
            <input
              type="checkbox"
              checked={hiddenHere.length === 0}
              onChange={() =>
                onChange(
                  hidden.filter(
                    (branch) =>
                      !branches.some((option) => option.branch === branch),
                  ),
                )
              }
            />
            <span>Show all branches</span>
          </label>
          {listed.map((option) => (
            <label key={option.branch} className={styles.branchOption}>
              <input
                type="checkbox"
                checked={option.isBaseline || !hidden.includes(option.branch)}
                disabled={option.isBaseline}
                onChange={() => toggle(option.branch)}
              />
              <span>
                {option.branch}
                <small>
                  {option.isBaseline
                    ? "baseline · always shown"
                    : option.detail}
                </small>
              </span>
            </label>
          ))}
          <div className="stage-multiselect-footer">
            <span>Hidden branches still count in insights</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function RunStrip({ runs }: { runs: InsightsRun[] }) {
  return (
    <span className={styles.runStrip} aria-hidden>
      {runs.slice(-6).map((run) => (
        <i
          key={run.runId}
          className={
            run.verdict === "passed" || run.verdict === "xpassed"
              ? styles.stripPass
              : styles.stripFail
          }
        />
      ))}
    </span>
  );
}
function HeatLegend() {
  return (
    <div className={styles.legend} aria-label="Pass rate legend">
      <span>
        <i className={styles.heatGreat} />
        ≥95%
      </span>
      <span>
        <i className={styles.heatGood} />
        80–94%
      </span>
      <span>
        <i className={styles.heatWarn} />
        60–79%
      </span>
      <span>
        <i className={styles.heatBad} />
        &lt;60%
      </span>
      <span>
        <i className={styles.legendRegressed} />
        regressed
      </span>
    </div>
  );
}
function BlastRadiusPanel({
  landscape,
  baseline,
  noun,
  focusBranch,
  onFocusBranch,
  hidden,
}: {
  landscape: Landscape;
  baseline: string | null;
  noun: string;
  focusBranch: string | null;
  onFocusBranch: (branch: string | null) => void;
  hidden: string[];
}) {
  const columns = landscape.branches.filter(
      (column) => !column.isBaseline && !hidden.includes(column.branch),
    ),
    widest = Math.max(
      1,
      ...columns.map(
        (column) => column.scopesRegressed + column.scopesImproved,
      ),
    );
  return (
    <section className={`panel ${styles.blastPanel}`}>
      <div className="panel-heading">
        <div>
          <h2>Branch blast radius</h2>
          <p>
            {noun}s each branch moved against {baseline ?? "the baseline"}
          </p>
        </div>
      </div>
      {columns.length ? (
        <ol className={styles.blastList}>
          {columns.map((column) => (
            <li key={column.branch}>
              <button
                type="button"
                className={
                  focusBranch === column.branch ? styles.blastActive : ""
                }
                onClick={() =>
                  onFocusBranch(
                    focusBranch === column.branch ? null : column.branch,
                  )
                }
              >
                <span className={styles.blastName} title={column.branch}>
                  {column.branch}
                </span>
                <span className={styles.blastBars} aria-hidden>
                  <i
                    className={styles.blastRegressed}
                    style={{
                      width: `${(column.scopesRegressed / widest) * 100}%`,
                    }}
                  />
                  <i
                    className={styles.blastImproved}
                    style={{
                      width: `${(column.scopesImproved / widest) * 100}%`,
                    }}
                  />
                </span>
                <span className={styles.blastCounts}>
                  <b className={styles.countBad}>▼ {column.scopesRegressed}</b>
                  <b className={styles.countGood}>▲ {column.scopesImproved}</b>
                </span>
                <small>
                  {column.runCount} runs · last{" "}
                  {column.lastRunAt ? formatDateShort(column.lastRunAt) : "—"}
                  {column.actors.length
                    ? ` · ${column.actors.slice(0, 2).join(", ")}`
                    : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.quiet}>
          {hidden.length
            ? "Every other branch is hidden from the table."
            : "Only the baseline branch has runs in this window."}
        </p>
      )}
    </section>
  );
}
function TestMatrixPanel({
  matrix,
  baseline,
  evalType,
  loadingCases,
  caseErrors,
  loadedCaseRuns,
  totalCaseRuns,
  focusBranch,
  focusTest,
  selectedCell,
  onSelectCell,
  problemsOnly,
  onProblemsOnly,
  search,
  onSearch,
  openingRunId,
  onOpenRun,
  layout,
}: {
  matrix: TestMatrix;
  baseline: string | null;
  evalType: EvalType;
  loadingCases: number;
  caseErrors: number;
  loadedCaseRuns: number;
  totalCaseRuns: number;
  focusBranch: string | null;
  focusTest: string | null;
  selectedCell: SelectedCell | null;
  onSelectCell: (cell: SelectedCell | null) => void;
  problemsOnly: boolean;
  onProblemsOnly: (value: boolean) => void;
  search: string;
  onSearch: (value: string) => void;
  openingRunId: string | null;
  onOpenRun: (runId: string) => void;
  layout: TableLayout;
}) {
  const tableRef = useRef<HTMLTableElement>(null),
    columns = matrix.branches.filter(
      (column) => column.isBaseline || !layout.hidden.includes(column.branch),
    ),
    rowHeaderWidth = layout.widths[ROW_HEADER_KEY] ?? DEFAULT_ROW_HEADER_WIDTH,
    query = search.trim().toLowerCase();
  const rows = matrix.tests.filter(
      (row) =>
        (!problemsOnly ||
          row.failingBranches > 0 ||
          row.flaky ||
          row.fixes > 0 ||
          row.testKey === focusTest) &&
        (!query ||
          row.label.toLowerCase().includes(query) ||
          row.group.toLowerCase().includes(query)),
    ),
    hidden = matrix.tests.length - rows.length;
  const selected = selectedCell
      ? matrix.cells.get(cellKey(selectedCell.testKey, selectedCell.branch))
      : undefined,
    selectedRow = selectedCell
      ? matrix.tests.find((row) => row.testKey === selectedCell.testKey)
      : undefined,
    baselineCell =
      selectedCell && baseline && selectedCell.branch !== baseline
        ? matrix.cells.get(cellKey(selectedCell.testKey, baseline))
        : undefined;
  return (
    <div className={styles.deepDive}>
      <section className={`panel ${styles.matrixPanel}`}>
        <div className="panel-heading">
          <div>
            <h2>Test × branch matrix</h2>
            <p>
              Latest result of each test on each branch, compared with{" "}
              {baseline ?? "the baseline"}. Based on every run in the selected
              server window.
              {loadingCases > 0 &&
                ` · Loading ${loadedCaseRuns}/${totalCaseRuns} runs…`}
              {caseErrors > 0 && ` · ${caseErrors} run(s) failed to load.`}
            </p>
          </div>
          <div className={styles.matrixTools}>
            <input
              type="search"
              aria-label="Filter tests"
              placeholder="Filter tests"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={problemsOnly}
                onChange={(event) => onProblemsOnly(event.target.checked)}
              />
              Problem tests only
            </label>
            <TableTools
              tableRef={tableRef}
              layout={layout}
              branches={matrix.branches.map((column) => ({
                branch: column.branch,
                isBaseline: column.isBaseline,
                detail: `${column.passRate.toFixed(0)}% passing${column.regressions ? ` · ▼${column.regressions}` : ""}`,
              }))}
            />
          </div>
        </div>
        <CellLegend />
        {matrix.tests.length === 0 ? (
          <p className={styles.quiet}>
            {loadingCases > 0
              ? "Loading test results…"
              : "No test results were recorded for these runs."}
          </p>
        ) : (
          <div className={styles.matrixScroll}>
            <table
              className={`${styles.matrix} ${styles.testMatrix}`}
              ref={tableRef}
              style={
                { "--row-header-width": `${rowHeaderWidth}px` } as CSSProperties
              }
            >
              <thead>
                <tr>
                  <RowHeaderCell layout={layout}>
                    Test{hidden > 0 ? ` · ${hidden} passing hidden` : ""}
                  </RowHeaderCell>
                  <th scope="col" className={styles.spreadHeader}>
                    Failing on
                  </th>
                  {columns.map((column) => (
                    <BranchHeaderCell
                      key={column.branch}
                      branch={column.branch}
                      isBaseline={column.isBaseline}
                      focused={focusBranch === column.branch}
                      layout={layout}
                      title={`${column.branch}\n${column.passRate.toFixed(0)}% of ${column.testsRun} tests passing · ${column.runsLoaded} run(s)`}
                      detail={`${column.isBaseline ? "baseline · " : ""}${column.passRate.toFixed(0)}%${column.regressions ? ` ▼${column.regressions}` : ""}${column.fixes ? ` ▲${column.fixes}` : ""}`}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.testKey}
                    id={`insight-test-${encodeURIComponent(row.testKey)}`}
                    className={focusTest === row.testKey ? styles.focusRow : ""}
                  >
                    <th scope="row" className={styles.rowHeader}>
                      <div className={styles.testName}>
                        <strong title={row.label}>{row.label}</strong>
                        {evalType === "e2e" && <small>{row.group}</small>}
                        <span className={styles.badges}>
                          {row.bottleneck && (
                            <em className={styles.badgeBad}>Bottleneck</em>
                          )}
                          {row.branchSpecific && (
                            <em className={styles.badgeWarn}>
                              Only {row.branchSpecific}
                            </em>
                          )}
                          {row.flaky && (
                            <em className={styles.badgeWarn}>Flaky</em>
                          )}
                          {row.environmentSplit && (
                            <em
                              className={styles.badgeEnv}
                              title={`On ${row.environmentSplit.branch}: fails on ${row.environmentSplit.failing.join(", ")}, passes on ${row.environmentSplit.passing.join(", ")}`}
                            >
                              Fails on {row.environmentSplit.failing.join(", ")}
                            </em>
                          )}
                          {row.fixes > 0 && (
                            <em className={styles.badgeGood}>
                              Fixed on {row.fixes}
                            </em>
                          )}
                        </span>
                      </div>
                    </th>
                    <td className={styles.spreadCell}>
                      <span className={styles.spreadBar} aria-hidden>
                        <i
                          style={{
                            width: `${(row.failingBranches / Math.max(1, row.branchesWithData)) * 100}%`,
                          }}
                        />
                      </span>
                      <small>
                        {row.failingBranches}/{row.branchesWithData}
                      </small>
                    </td>
                    {columns.map((column) => {
                      const cell = matrix.cells.get(
                          cellKey(row.testKey, column.branch),
                        ),
                        state: CellState = cell?.state ?? "missing",
                        isSelected =
                          selectedCell?.testKey === row.testKey &&
                          selectedCell.branch === column.branch;
                      return (
                        <td
                          key={column.branch}
                          className={`${column.isBaseline ? styles.baselineColumn : ""} ${focusBranch === column.branch ? styles.focusColumn : ""}`}
                        >
                          <button
                            type="button"
                            disabled={!cell}
                            className={`${styles.testCell} ${styles[`cell_${state}`]} ${isSelected ? styles.cellSelected : ""}`}
                            aria-label={`${row.label} on ${column.branch}: ${CELL_LABEL[state]}`}
                            title={
                              cell
                                ? cellTitle(row.label, column.branch, cell)
                                : `${row.label} not run on ${column.branch}`
                            }
                            onClick={() =>
                              onSelectCell(
                                isSelected
                                  ? null
                                  : {
                                      testKey: row.testKey,
                                      branch: column.branch,
                                    },
                              )
                            }
                          >
                            {CELL_GLYPH[state]}
                            {cell && cell.observations.length > 1 && (
                              <sub>
                                {cell.passes}/{cell.observations.length}
                              </sub>
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
        )}
      </section>
      {selected && selectedRow && (
        <section className={`panel ${styles.cellDetail}`}>
          <div className="panel-heading">
            <div>
              <h2>{selectedRow.label}</h2>
              <p>
                {CELL_LABEL[selected.state]} on {selected.branch}
                {selectedRow.bottleneck &&
                  ` · fails on ${selectedRow.failingBranches} of ${selectedRow.branchesWithData} branches`}
              </p>
            </div>
            <button type="button" onClick={() => onSelectCell(null)}>
              Close
            </button>
          </div>
          <div className={styles.timelines}>
            <ObservationTimeline
              title={selected.branch}
              observations={selected.observations}
              openingRunId={openingRunId}
              onOpenRun={onOpenRun}
            />
            {baselineCell && (
              <ObservationTimeline
                title={`${baseline} (baseline)`}
                observations={baselineCell.observations}
                openingRunId={openingRunId}
                onOpenRun={onOpenRun}
              />
            )}
            <div className={styles.allBranches}>
              <h3>Across every branch</h3>
              <span className={styles.historyStrip}>
                {selectedRow.history.map((observation, index) => (
                  <i
                    key={`${observation.runId}:${index}`}
                    className={styles[`outcome_${observation.outcome}`]}
                    title={`${formatTime(observation.startedAt)} · ${observation.outcome}`}
                  />
                ))}
              </span>
              <small>
                {selectedRow.failureCount} failure
                {selectedRow.failureCount === 1 ? "" : "s"} in{" "}
                {selectedRow.history.length} result
                {selectedRow.history.length === 1 ? "" : "s"}, oldest first
              </small>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
function cellTitle(label: string, branch: string, cell: TestBranchCell) {
  return [
    `${label} on ${branch}`,
    `${CELL_LABEL[cell.state]} · latest ${cell.latest.outcome} ${formatTime(cell.latest.startedAt)}`,
    `${cell.passes} pass / ${cell.failures} fail over ${cell.observations.length} run(s)`,
    cell.flips ? `${cell.flips} flip(s)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
function CellLegend() {
  const states: CellState[] = [
    "regression",
    "fail",
    "flaky",
    "fixed",
    "pass",
    "missing",
  ];
  return (
    <div className={styles.cellLegend} aria-label="Matrix legend">
      {states.map((state) => (
        <span key={state}>
          <i className={`${styles.testCell} ${styles[`cell_${state}`]}`}>
            {CELL_GLYPH[state]}
          </i>
          {CELL_LABEL[state]}
        </span>
      ))}
      <span className={styles.legendNote}>n/m = passes of runs</span>
    </div>
  );
}
function ObservationTimeline({
  title,
  observations,
  openingRunId,
  onOpenRun,
}: {
  title: string;
  observations: Observation[];
  openingRunId: string | null;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <div className={styles.timeline}>
      <h3>{title}</h3>
      <ol>
        {[...observations].reverse().map((observation, index) => (
          <li key={`${observation.runId}:${index}`}>
            <i className={styles[`outcome_${observation.outcome}`]}>
              {OUTCOME_GLYPH[observation.outcome]}
            </i>
            <span>
              {formatTime(observation.startedAt)}
              {observation.gitSha && (
                <code>{observation.gitSha.slice(0, 7)}</code>
              )}
              <small>{observation.context}</small>
            </span>
            <button
              type="button"
              disabled={openingRunId === observation.runId}
              onClick={() => onOpenRun(observation.runId)}
            >
              {openingRunId === observation.runId ? "Opening…" : "Open run →"}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
