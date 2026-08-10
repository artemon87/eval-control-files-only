"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { evalCases, evalRuns } from "./lib/eval-data";
import { configuredEvalApi } from "./lib/eval-api";
import { e2eHistory, unitHistory } from "./lib/eval-history";
import type { E2EHistoryPoint } from "./lib/eval-history";
import type { EvalCase, EvalRun, EvalType, Verdict } from "./lib/eval-types";

type View = "overview" | "runs" | "history" | "compare" | "schema";

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
  return <span className={`status status--${verdict}`}><i />{verdict}</span>;
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
  if (!ms) return "—";
  const seconds = Math.round(ms / 1000);
  return seconds > 90 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function runScope(run: EvalRun) {
  if (run.evalType === "e2e") {
    return { primary: run.target, secondary: `${run.stage} · live conversation` };
  }
  const skill = run.unitConfig?.skillId ?? run.target;
  return { primary: skill, secondary: `${run.unitConfig?.bsaEnvironment ?? run.stage} · skill v${run.unitConfig?.skillVersion ?? "unknown"} · mock-backed` };
}

function MetricCard({ label, value, note, tone, spark }: { label: string; value: string; note: string; tone: string; spark: number[] }) {
  const points = spark.map((value, index) => `${index * 18},${34 - value * 0.28}`).join(" ");
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon--${tone}`}>{tone === "red" ? "!" : tone === "blue" ? "↗" : tone === "violet" ? "◷" : "✓"}</div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      <svg className={`spark spark--${tone}`} viewBox="0 0 90 38" aria-hidden="true"><polyline points={points} /></svg>
    </article>
  );
}

function TrendChart() {
  return (
    <div className="trend-chart" role="img" aria-label="Pass rate trend for E2E and unit evaluations">
      <div className="chart-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span></div>
      <svg viewBox="0 0 660 210" preserveAspectRatio="none">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22a78f" stopOpacity=".18"/><stop offset="1" stopColor="#22a78f" stopOpacity="0"/></linearGradient>
        </defs>
        <g className="grid-lines"><line x1="0" x2="660" y1="18" y2="18"/><line x1="0" x2="660" y1="72" y2="72"/><line x1="0" x2="660" y1="126" y2="126"/><line x1="0" x2="660" y1="180" y2="180"/></g>
        <path className="area" d="M0,92 C70,82 96,104 156,78 C228,48 264,80 324,58 C386,35 426,62 480,43 C548,20 596,42 660,24 L660,210 L0,210 Z"/>
        <path className="line line--e2e" d="M0,92 C70,82 96,104 156,78 C228,48 264,80 324,58 C386,35 426,62 480,43 C548,20 596,42 660,24"/>
        <path className="line line--unit" d="M0,64 C76,58 112,72 170,54 C230,36 275,42 330,39 C410,34 446,44 502,28 C558,16 610,22 660,18"/>
      </svg>
      <div className="chart-days"><span>Aug 1</span><span>Aug 2</span><span>Aug 3</span><span>Aug 4</span><span>Aug 5</span><span>Aug 6</span><span>Today</span></div>
    </div>
  );
}

function RunsTable({ runs, onOpen }: { runs: EvalRun[]; onOpen: (run: EvalRun) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Type</th><th>Evaluation scope</th><th>Verdict</th><th>Pass rate</th><th>Mean score</th><th>Duration</th><th>Started</th></tr></thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId} tabIndex={0} onClick={() => onOpen(run)} onKeyDown={(event) => event.key === "Enter" && onOpen(run)}>
              <td><button className="run-link" onClick={() => onOpen(run)}>{run.runId}</button><small>{run.actor} · {run.trigger}</small></td>
              <td><TypeBadge type={run.evalType} /></td>
              <td><span>{runScope(run).primary}</span><small>{runScope(run).secondary}</small></td>
              <td><StatusBadge verdict={run.verdict} /></td>
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
  const api = useMemo(() => configuredEvalApi(), []);
  const [runs, setRuns] = useState<EvalRun[]>(evalRuns);
  const [cases, setCases] = useState<EvalCase[]>(evalCases);
  const [dataSource, setDataSource] = useState<"api" | "demo">("demo");
  const [loading, setLoading] = useState(Boolean(api));
  const [apiError, setApiError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | EvalType>("all");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
  const [historyFocus, setHistoryFocus] = useState<{ type: EvalType; stage?: string; target?: string; skillId?: string; environment?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setApiError(null);
    try {
      setRuns(await api.listRuns());
      setDataSource("api");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to load the Eval API");
      setRuns(evalRuns);
      setDataSource("demo");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api.listRuns(controller.signal).then((items) => {
      setRuns(items);
      setDataSource("api");
      setApiError(null);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setApiError(error instanceof Error ? error.message : "Unable to load the Eval API");
      setRuns(evalRuns);
      setDataSource("demo");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    if (!selectedRun || !api || dataSource !== "api") return;
    const controller = new AbortController();
    void api.listCases(selectedRun, controller.signal)
      .then(setCases)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setApiError(error instanceof Error ? error.message : "Unable to load cases");
      });
    return () => controller.abort();
  }, [api, dataSource, selectedRun]);

  const filteredRuns = useMemo(() => runs.filter((run) => {
    const haystack = `${run.runId} ${run.actor} ${run.stage} ${run.target} ${run.gitSha} ${run.unitConfig?.skillId ?? ""} ${run.unitConfig?.skillVersion ?? ""} ${run.e2eConfig?.selectedSuites.join(" ") ?? ""}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (type === "all" || run.evalType === type) && (verdict === "all" || run.verdict === verdict);
  }), [runs, search, type, verdict]);

  const completed = runs.filter((run) => run.executionStatus === "completed");
  const passed = completed.filter((run) => run.verdict === "passed").length;
  const running = runs.filter((run) => run.executionStatus === "running" || run.executionStatus === "queued").length;

  const openRun = (run: EvalRun) => {
    if (dataSource === "api") setCases([]);
    setSelectedRun(run);
    setView("runs");
  };

  const openHistory = (run: EvalRun) => {
    setHistoryFocus(run.evalType === "e2e"
      ? { type: "e2e", stage: run.stage, target: run.target }
      : { type: "unit", skillId: run.unitConfig?.skillId ?? run.target, environment: run.unitConfig?.bsaEnvironment ?? run.stage });
    setSelectedRun(null);
    setView("history");
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand"><span>EC</span><div><strong>Eval Control</strong><small>Quality operations</small></div>{sidebarOpen && <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>×</button>}</div>
        <nav aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setSelectedRun(null); if (item.id === "history") setHistoryFocus(null); setSidebarOpen(false); }}><span>{item.glyph}</span>{item.label}</button>)}
          <p>Manage</p>
          <button disabled title="Policy management is planned"><span>⌁</span>Policies<b className="nav-soon">soon</b></button>
          <button disabled title="Metric management is planned"><span>✣</span>Custom metrics<b className="nav-soon">soon</b></button>
        </nav>
        <div className="sidebar-note"><span>Data status</span><strong><i /> {apiError ? "API fallback active" : dataSource === "api" ? "Live API connected" : "Demo dataset"}</strong><small>FastAPI · MongoDB · read only</small></div>
        <div className="profile"><span>AK</span><div><strong>Artem Kovtunenko</strong><small>Evaluation operator</small></div><b>•••</b></div>
      </aside>

      <main className="main">
        <header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button><div className="breadcrumb">Evaluation framework <span>/</span> {navItems.find((item) => item.id === view)?.label} <span>·</span> {dataSource === "api" ? "Live MongoDB" : "Demo data"}</div><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<i /></button><button className="primary-button" onClick={() => void loadRuns()} disabled={!api || loading}>{loading ? "Refreshing…" : "↻ Refresh data"}</button></div></header>

        <div className="content">
          {view === "overview" && <>
            <div className="page-heading"><div><span className="eyebrow">Evaluation health</span><h1>Good morning, Artem</h1><p>Here’s how your evaluation system is performing across environments.</p></div><div className="time-filter"><button className="selected">7 days</button><button>30 days</button><button>90 days</button></div></div>
            <section className="metrics-grid">
              <MetricCard label="Gate pass rate" value={`${Math.round((passed / Math.max(completed.length, 1)) * 100)}%`} note="completed runs in view" tone="green" spark={[18, 26, 24, 33, 40, 48]} />
              <MetricCard label="Runs in progress" value={String(running)} note="1 running · 1 queued" tone="blue" spark={[14, 20, 18, 30, 27, 37]} />
              <MetricCard label="Failed or blocked" value="3" note="2 need attention" tone="red" spark={[28, 20, 25, 17, 15, 11]} />
              <MetricCard label="P95 duration" value="4m 42s" note="24s faster this week" tone="violet" spark={[45, 42, 38, 32, 34, 26]} />
            </section>
            <section className="dashboard-grid">
              <article className="panel trend-panel"><div className="panel-heading"><div><h2>Pass rate trend</h2><p>Daily gate result by evaluation type</p></div><div className="legend"><span><i className="e2e-dot" />E2E</span><span><i className="unit-dot" />Unit</span></div></div><TrendChart /></article>
              <article className="panel attention-panel"><div className="panel-heading"><div><h2>Needs attention</h2><p>Recent failures and blocks</p></div><button>View all</button></div>
                <div className="attention-list">
                  <button onClick={() => openRun(evalRuns.find((run) => run.runId === "e2e-97a0f7b810")!)}><span className="alert-icon">!</span><div><strong>PTO balance guidance failed</strong><small>general_inquiry · E2E</small></div><b>2.0</b></button>
                  <button onClick={() => openRun(evalRuns.find((run) => run.runId === "unit-1f8ad633c5")!)}><span className="alert-icon">!</span><div><strong>Feedback skill version regressed</strong><small>v1.2.0 · Unit</small></div><b>66.7%</b></button>
                  <button onClick={() => openRun(evalRuns.find((run) => run.runId === "e2e-72279cb8a3")!)}><span className="alert-icon blocked">×</span><div><strong>Judge service unavailable</strong><small>prod-staging · System</small></div><b>Error</b></button>
                </div>
              </article>
            </section>
            <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent evaluation runs</h2><p>Latest activity across all environments</p></div><button className="text-button" onClick={() => setView("runs")}>View all runs →</button></div><RunsTable runs={runs.slice(0, 5)} onOpen={openRun} /></section>
          </>}

          {view === "runs" && <>
            <div className="page-heading compact"><div><span className="eyebrow">Operations</span><h1>{selectedRun ? selectedRun.runId : "Evaluation runs"}</h1><p>{selectedRun ? "Run result, suite breakdown and case-level evidence." : "Search, filter and inspect every E2E and unit evaluation."}</p></div>{selectedRun && <button className="secondary-button" onClick={() => setSelectedRun(null)}>← All runs</button>}</div>
            {!selectedRun ? <section className="panel runs-panel">
              <div className="filter-bar"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search run, actor, SHA or target…" /></label><select value={type} onChange={(event) => setType(event.target.value as "all" | EvalType)} aria-label="Evaluation type"><option value="all">All types</option><option value="e2e">E2E</option><option value="unit">Unit</option></select><select value={verdict} onChange={(event) => setVerdict(event.target.value as "all" | Verdict)} aria-label="Verdict"><option value="all">All verdicts</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="blocked">Blocked</option><option value="pending">Pending</option></select><button className="filter-button">☷ More filters</button></div>
              <RunsTable runs={filteredRuns} onOpen={openRun} />
              <div className="table-footer"><span>Showing {filteredRuns.length} of {runs.length} runs</span><div><button disabled>←</button><button className="current">1</button><button disabled>→</button></div></div>
            </section> : <RunSummary run={selectedRun} cases={dataSource === "api" ? cases : evalCases.filter((item) => item.runId === selectedRun.runId)} onCase={setSelectedCase} onHistory={openHistory} />}
          </>}

          {apiError && <div className="toast"><span>!</span>{apiError} · showing deterministic demo data</div>}
          {view === "history" && <HistoryView initialFocus={historyFocus} runs={runs} live={dataSource === "api"} />}
          {view === "compare" && <CompareView runs={runs} />}
          {view === "schema" && <SchemaView />}
        </div>
      </main>
      {selectedCase && <CaseDrawer item={selectedCase} onClose={() => setSelectedCase(null)} />}
    </div>
  );
}

function RunSummary({ run, cases, onCase, onHistory }: { run: EvalRun; cases: EvalCase[]; onCase: (item: EvalCase) => void; onHistory: (run: EvalRun) => void }) {
  const scope = runScope(run);
  return <>
    <div className="detail-grid">
      <section className="panel run-hero"><div><TypeBadge type={run.evalType} /><StatusBadge verdict={run.verdict} /><span className={`execution execution--${run.executionStatus}`}>{run.executionStatus}</span></div><h2>{scope.primary}</h2><p>{scope.secondary} · triggered by <strong>{run.actor}</strong> through {run.trigger.toUpperCase()} · {run.evalType === "e2e" ? `target manifest ${run.datasetVersion}` : `evalset ${run.datasetVersion}`}</p>{run.evalType === "e2e" ? <div className="scope-chips"><span>Live target</span><span>No tool mocks</span><span>{run.e2eConfig?.selectedSuites.length ?? run.suites.length} suites</span></div> : <div className="scope-chips unit"><span>{run.unitConfig?.mode ?? "all"} turns</span><span>Per-skill mocks</span><span>Tool + response quality</span></div>}<button className="history-link" onClick={() => onHistory(run)}>View {run.evalType === "e2e" ? "target" : "skill"} history →</button><div className="detail-stats"><span><small>Pass rate</small><strong>{run.summary.passRatePct || "—"}{run.summary.passRatePct ? "%" : ""}</strong></span><span><small>Mean score</small><strong>{run.summary.meanScore || "—"}</strong></span><span><small>Cases</small><strong>{run.summary.total}</strong></span><span><small>Duration</small><strong>{formatDuration(run.durationMs)}</strong></span></div></section>
      <section className="panel suite-panel"><div className="panel-heading"><div><h2>{run.evalType === "e2e" ? "Suite breakdown" : "Skill / metric breakdown"}</h2><p>{run.evalType === "e2e" ? "Live conversation result by enabled suite" : "Mock-backed cases scored for this single skill"}</p></div></div>{run.suites.length ? run.suites.map((suite) => <div className="suite-row" key={suite.name}><div><strong>{suite.name}</strong><small>{suite.total ? `${suite.passed} passed · ${suite.failed} failed` : "Enabled suite · open cases for results"}</small></div><div className="suite-bar"><i><b style={{ width: `${(suite.passed / Math.max(suite.total, 1)) * 100}%` }} /></i><span>{suite.total ? suite.meanScore.toFixed(2) : "—"}</span></div></div>) : <div className="empty compact-empty"><strong>No results yet</strong><span>This run has not produced suite results.</span></div>}</section>
    </div>
    <section className="panel cases-panel"><div className="panel-heading"><div><h2>Evaluated cases</h2><p>Case-level verdicts, evidence and latency</p></div><span className="result-count">{cases.length} results</span></div>
      {cases.length ? <div className="table-wrap"><table className="cases-table"><thead><tr><th>Case</th><th>Suite</th><th>Verdict</th><th>Score</th><th>Threshold</th><th>Latency</th><th /></tr></thead><tbody>{cases.map((item) => <tr key={item.caseId} onClick={() => onCase(item)}><td><button className="run-link">{item.caseId}</button><small>{item.role} · tier {item.tier}</small></td><td>{item.suite}</td><td><StatusBadge verdict={item.verdict === "error" ? "blocked" : item.verdict} /></td><td><strong className={item.score < item.threshold ? "bad-score" : "score"}>{item.score.toFixed(1)}</strong></td><td>{item.threshold.toFixed(1)}</td><td>{(item.responseTimeMs / 1000).toFixed(1)}s</td><td><button className="row-arrow" aria-label={`Open ${item.caseId}`}>›</button></td></tr>)}</tbody></table></div> : <div className="empty"><strong>No case documents available</strong><span>Unit or in-progress runs can expose a different case shape.</span></div>}
    </section>
  </>;
}

function CaseDrawer({ item, onClose }: { item: EvalCase; onClose: () => void }) {
  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`Evaluation case ${item.caseId}`}><button className="drawer-backdrop" onClick={onClose} aria-label="Close case detail" /><aside className="case-drawer"><header><div><span className="eyebrow">Case evidence</span><h2>{item.caseId}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="drawer-body"><div className="case-summary"><StatusBadge verdict={item.verdict === "error" ? "blocked" : item.verdict} /><span>Score <strong>{item.score.toFixed(1)}</strong> / threshold {item.threshold.toFixed(1)}</span><span>{item.responseTimeMs ? `${(item.responseTimeMs / 1000).toFixed(2)}s` : "unit case"}</span></div><dl className="meta-grid"><div><dt>Suite</dt><dd>{item.suite}</dd></div><div><dt>Role / type</dt><dd>{item.role}</dd></div><div><dt>Tier</dt><dd>{item.tier || "—"}</dd></div><div><dt>Skill</dt><dd>{item.skill}</dd></div></dl><EvidenceBlock title="Evaluation input" content={item.input} /><EvidenceBlock title="Assistant response" content={item.responseText || "No response stored"} />{item.scores && <EvidenceBlock title="Unit metric scores" content={JSON.stringify(item.scores, null, 2)} tone={item.verdict === "failed" ? "danger" : "default"} />}{item.toolCalls?.length ? <EvidenceBlock title="Observed tool calls" content={JSON.stringify(item.toolCalls, null, 2)} /> : null}<EvidenceBlock title="Judge explanation" content={item.explanation} tone={item.verdict === "failed" ? "danger" : "default"} />{item.bugRef && <div className="bug-ref"><span>Linked issue</span><strong>{item.bugRef}</strong></div>}{item.error && <EvidenceBlock title="Execution error" content={item.error} tone="danger" />}</div></aside></div>;
}

function EvidenceBlock({ title, content, tone = "default" }: { title: string; content: string; tone?: "default" | "danger" }) {
  return <section className={`evidence evidence--${tone}`}><h3>{title}</h3><p>{content}</p></section>;
}

type HistoryFocus = { type: EvalType; stage?: string; target?: string; skillId?: string; environment?: string } | null;
type TrendPoint = { id: string; startedAt: string; passRatePct: number; meanScore: number; totalCases: number; durationMs: number; verdict: Verdict; scope: string; batchId?: string };

function aggregateE2E(points: E2EHistoryPoint[]): TrendPoint[] {
  const groups = new Map<string, E2EHistoryPoint[]>();
  points.forEach((point) => groups.set(point.batchId, [...(groups.get(point.batchId) ?? []), point]));
  return Array.from(groups.entries()).map(([batchId, items]) => {
    const totalCases = items.reduce((sum, item) => sum + item.totalCases, 0);
    const weighted = (key: "passRatePct" | "meanScore") => items.reduce((sum, item) => sum + item[key] * item.totalCases, 0) / totalCases;
    const passRatePct = weighted("passRatePct");
    const verdict: Verdict = passRatePct >= 90 ? "passed" : "failed";
    return { id: batchId, batchId, startedAt: items[0].startedAt, passRatePct, meanScore: weighted("meanScore"), totalCases, durationMs: Math.max(...items.map((item) => item.durationMs)), verdict, scope: `${items.length} targets` };
  }).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function HistoryChart({ points, title }: { points: TrendPoint[]; title: string }) {
  const width = 760;
  const plotLeft = 46;
  const plotRight = 730;
  const plotTop = 22;
  const plotBottom = 182;
  const x = (index: number) => points.length < 2 ? (plotLeft + plotRight) / 2 : plotLeft + (index / (points.length - 1)) * (plotRight - plotLeft);
  const y = (percent: number) => plotTop + ((100 - percent) / 100) * (plotBottom - plotTop);
  const passPoints = points.map((point, index) => `${x(index)},${y(point.passRatePct)}`).join(" ");
  const scorePoints = points.map((point, index) => `${x(index)},${y((point.meanScore / 5) * 100)}`).join(" ");
  return <section className="panel history-chart-card"><div className="panel-heading"><div><h2>{title}</h2><p>Pass rate and normalized mean score over time</p></div><div className="history-legend"><span><i />Pass rate</span><span><i />Mean score</span><span><i />90% gate</span></div></div><div className="history-chart" role="img" aria-label={`${title} historical trend`}><svg viewBox={`0 0 ${width} 230`} preserveAspectRatio="none"><g className="history-grid">{[100,75,50,25,0].map((value) => <g key={value}><line x1={plotLeft} x2={plotRight} y1={y(value)} y2={y(value)}/><text x="7" y={y(value)+3}>{value}%</text></g>)}</g><line className="gate-line" x1={plotLeft} x2={plotRight} y1={y(90)} y2={y(90)}/>{points.length > 1 && <><polyline className="history-pass-line" points={passPoints}/><polyline className="history-score-line" points={scorePoints}/></>}{points.map((point,index) => <g key={point.id}><circle className="history-pass-dot" cx={x(index)} cy={y(point.passRatePct)} r="4"><title>{point.passRatePct.toFixed(1)}% pass rate</title></circle><circle className="history-score-dot" cx={x(index)} cy={y((point.meanScore/5)*100)} r="3"><title>{point.meanScore.toFixed(2)} mean score</title></circle><text className="point-value" x={x(index)} y={Math.max(12,y(point.passRatePct)-10)} textAnchor="middle">{point.passRatePct.toFixed(point.passRatePct % 1 ? 1 : 0)}%</text><text className="point-date" x={x(index)} y="211" textAnchor="middle">{formatDateShort(point.startedAt)}</text></g>)}</svg></div></section>;
}

function HistoryView({ initialFocus, runs, live }: { initialFocus: HistoryFocus; runs: EvalRun[]; live: boolean }) {
  const e2eSource = live ? runs.filter((run) => run.evalType === "e2e" && run.executionStatus === "completed").map((run) => ({ runId: run.runId, batchId: run.batchId ?? run.runId, startedAt: run.startedAt, stage: run.stage, target: run.target, passRatePct: run.summary.passRatePct, meanScore: run.summary.meanScore, totalCases: run.summary.total, durationMs: run.durationMs ?? 0, verdict: run.verdict })) : e2eHistory;
  const unitSource = live ? runs.filter((run) => run.evalType === "unit" && run.executionStatus === "completed").map((run) => ({ runId: run.runId, batchId: run.batchId, startedAt: run.startedAt, skillId: run.unitConfig?.skillId ?? run.target, environment: run.unitConfig?.bsaEnvironment ?? run.stage, passRatePct: run.summary.passRatePct, meanScore: run.summary.meanScore, generalQuality: 0, toolUseQuality: 0, totalCases: run.summary.total, durationMs: run.durationMs ?? 0, verdict: run.verdict })) : unitHistory;
  const stages = Array.from(new Set(e2eSource.map((point) => point.stage)));
  const skills = Array.from(new Set([...unitSkills.map((skill) => skill.id), ...unitSource.map((point) => point.skillId)]));
  const initialStage = initialFocus?.stage && stages.includes(initialFocus.stage) ? initialFocus.stage : (stages[0] ?? "1-dev-staging");
  const initialSkill = initialFocus?.skillId && skills.includes(initialFocus.skillId) ? initialFocus.skillId : skills[0];
  const [historyType, setHistoryType] = useState<EvalType>(initialFocus?.type ?? "e2e");
  const [stage, setStage] = useState(initialStage);
  const stageTargets = Array.from(new Set(e2eSource.filter((point) => point.stage === stage).map((point) => point.target)));
  const [target, setTarget] = useState(initialFocus?.target && stageTargets.includes(initialFocus.target) ? initialFocus.target : "all");
  const [skillId, setSkillId] = useState(initialSkill);
  const [environment, setEnvironment] = useState(initialFocus?.environment ?? "all");
  const [range, setRange] = useState("30d");

  const e2eFiltered = e2eSource.filter((point) => point.stage === stage && (target === "all" || point.target === target));
  const e2eTrend: TrendPoint[] = target === "all" ? aggregateE2E(e2eFiltered) : e2eFiltered.map((point) => ({ id: point.runId, startedAt: point.startedAt, passRatePct: point.passRatePct, meanScore: point.meanScore, totalCases: point.totalCases, durationMs: point.durationMs, verdict: point.verdict, scope: point.target, batchId: point.batchId })).sort((a,b) => a.startedAt.localeCompare(b.startedAt));
  const unitFiltered = unitSource.filter((point) => point.skillId === skillId && (environment === "all" || point.environment === environment)).sort((a,b) => a.startedAt.localeCompare(b.startedAt));
  const unitTrend: TrendPoint[] = unitFiltered.map((point) => ({ id: point.runId, startedAt: point.startedAt, passRatePct: point.passRatePct, meanScore: point.meanScore, totalCases: point.totalCases, durationMs: point.durationMs, verdict: point.verdict, scope: point.environment, batchId: point.batchId }));
  const trend = historyType === "e2e" ? e2eTrend : unitTrend;
  const latest = trend.at(-1);
  const previous = trend.at(-2);
  const passDelta = latest && previous ? latest.passRatePct - previous.passRatePct : 0;
  const latestUnit = unitFiltered.at(-1);
  const selectedSkill = unitSkills.find((skill) => skill.id === skillId) ?? { id: skillId, label: skillId, tools: [] };
  const latestByTarget = stageTargets.map((targetId) => e2eSource.filter((point) => point.stage === stage && point.target === targetId).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).at(-1)!);

  return <>
    <div className="page-heading history-heading"><div><span className="eyebrow">Longitudinal quality</span><h1>Evaluation history</h1><p>Track the same E2E target or unit skill across runs without mixing their scopes.</p></div><div className="type-switch"><button className={historyType === "e2e" ? "active" : ""} onClick={() => setHistoryType("e2e")}>E2E history</button><button className={historyType === "unit" ? "active" : ""} onClick={() => setHistoryType("unit")}>Unit skill history</button></div></div>
    <section className="panel history-controls"><div className="history-control-copy"><TypeBadge type={historyType}/><div><strong>{historyType === "e2e" ? "Target-scoped history" : "Skill-scoped history"}</strong><small>{historyType === "e2e" ? "Stage rollups are case-weighted across fan-out targets." : "Every unit run belongs to exactly one skill and one skill version."}</small></div></div>{historyType === "e2e" ? <><label><span>Stage</span><select aria-label="History stage" value={stage} onChange={(event) => { setStage(event.target.value); setTarget("all"); }}>
      {stages.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Target</span><select aria-label="History target" value={target} onChange={(event) => setTarget(event.target.value)}><option value="all">All targets · stage rollup</option>{stageTargets.map((value) => <option key={value}>{value}</option>)}</select></label></> : <><label><span>Skill</span><select aria-label="History skill" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((value) => <option key={value} value={value}>{unitSkills.find((skill) => skill.id === value)?.label ?? value}</option>)}</select></label><label><span>Environment</span><select aria-label="History environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}><option value="all">All environments</option><option value="staging">Staging BSA</option><option value="dev">Development BSA</option></select></label></>}<div className="range-switch"><button className={range === "7d" ? "active" : ""} onClick={() => setRange("7d")}>7d</button><button className={range === "30d" ? "active" : ""} onClick={() => setRange("30d")}>30d</button><button className={range === "90d" ? "active" : ""} onClick={() => setRange("90d")}>90d</button></div></section>
    <section className="history-metrics"><article className="panel"><span>Latest pass rate</span><strong>{latest?.passRatePct.toFixed(1) ?? "—"}%</strong><small className={passDelta >= 0 ? "delta-good" : "delta-bad"}>{passDelta >= 0 ? "+" : ""}{passDelta.toFixed(1)} points vs prior</small></article><article className="panel"><span>Latest mean score</span><strong>{latest?.meanScore.toFixed(2) ?? "—"}</strong><small>out of 5.0</small></article><article className="panel"><span>Historical runs</span><strong>{trend.length}</strong><small>{historyType === "e2e" && target === "all" ? `${stageTargets.length} targets per batch` : "matching this scope"}</small></article><article className="panel"><span>Gate record</span><strong>{trend.filter((point) => point.passRatePct >= 90).length}/{trend.length}</strong><small>runs at or above 90%</small></article></section>
    {trend.length ? <HistoryChart points={trend} title={historyType === "e2e" ? (target === "all" ? `${stage} · stage rollup` : target) : selectedSkill.label}/> : <section className="panel empty"><strong>No historical runs</strong><span>Change the environment or scope selection.</span></section>}
    {historyType === "e2e" ? <section className="target-history-grid">{latestByTarget.map((point) => <button key={point.target} className={`panel target-history-card ${target === point.target ? "selected" : ""}`} onClick={() => setTarget(point.target)}><div><span className="target-dot"/><strong>{point.target}</strong></div><b>{point.passRatePct.toFixed(1)}%</b><small>{e2eSource.filter((item) => item.stage === stage && item.target === point.target).length} historical runs · latest {formatDateShort(point.startedAt)}</small><i><em style={{width:`${point.passRatePct}%`}}/></i></button>)}</section> : <section className="panel unit-history-summary"><div><span className="collection-icon case">S</span><div><strong>{selectedSkill.label}</strong><small>{selectedSkill.id}</small></div></div><div><span>Declared tools</span><strong>{selectedSkill.tools.join(" · ") || "Stored with skill definition"}</strong></div><div><span>General quality</span><strong>{latestUnit?.generalQuality ? latestUnit.generalQuality.toFixed(2) : "case metric"}</strong></div><div><span>Tool use quality</span><strong>{latestUnit?.toolUseQuality ? latestUnit.toolUseQuality.toFixed(2) : "case metric"}</strong></div></section>}
    <section className="panel history-table"><div className="panel-heading"><div><h2>{historyType === "e2e" && target === "all" ? "Scheduled batch history" : "Matching run history"}</h2><p>{historyType === "e2e" && target === "all" ? "One rollup row per multi-target workflow execution" : "Every execution for the selected scope"}</p></div><span className="result-count">{trend.length} results</span></div><div className="table-wrap"><table><thead><tr><th>{historyType === "e2e" && target === "all" ? "Batch" : "Run"}</th><th>Scope</th><th>Verdict</th><th>Pass rate</th><th>Mean score</th><th>Cases</th><th>Duration</th><th>Started</th></tr></thead><tbody>{[...trend].reverse().map((point) => <tr key={point.id}><td><span className="run-link">{point.id}</span>{point.batchId && point.id !== point.batchId && <small>batch {point.batchId}</small>}</td><td>{point.scope}</td><td><StatusBadge verdict={point.verdict}/></td><td><strong>{point.passRatePct.toFixed(1)}%</strong></td><td>{point.meanScore.toFixed(2)}</td><td>{point.totalCases}</td><td>{formatDuration(point.durationMs)}</td><td>{formatTime(point.startedAt)}</td></tr>)}</tbody></table></div></section>
  </>;
}

function CompareView({ runs }: { runs: EvalRun[] }) {
  const [compareType, setCompareType] = useState<EvalType>("e2e");
  return <>
    <div className="page-heading compact"><div><span className="eyebrow">Regression analysis</span><h1>Compare evaluation runs</h1><p>Compare like with like: E2E targets and unit skill runs use separate baselines.</p></div><div className="type-switch"><button className={compareType === "e2e" ? "active" : ""} onClick={() => setCompareType("e2e")}>E2E targets</button><button className={compareType === "unit" ? "active" : ""} onClick={() => setCompareType("unit")}>Unit skills</button></div></div>
    <TypeComparison key={compareType} runs={runs} type={compareType} />
  </>;
}

function TypeComparison({ runs, type }: { runs: EvalRun[]; type: EvalType }) {
  return type === "unit" ? <UnitVersionComparison runs={runs} /> : <E2ERunComparison runs={runs} />;
}

function E2ERunComparison({ runs }: { runs: EvalRun[] }) {
  const comparable = runs.filter((run) => run.executionStatus === "completed" && run.evalType === "e2e");
  if (comparable.length < 2) return <section className="panel empty"><strong>Two completed E2E runs are required</strong><span>Load more history for the same target before comparing.</span></section>;
  return <RunPairPicker comparable={comparable} unitVersions={false} />;
}

function UnitVersionComparison({ runs }: { runs: EvalRun[] }) {
  const unitRuns = runs.filter((run) => run.executionStatus === "completed" && run.evalType === "unit");
  const skills = Array.from(new Set(unitRuns.map((run) => run.unitConfig?.skillId).filter((value): value is string => Boolean(value))));
  const [skillId, setSkillId] = useState(skills[0] ?? "");
  const byVersion = new Map<string, EvalRun>();
  unitRuns.filter((run) => run.unitConfig?.skillId === skillId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).forEach((run) => {
    const version = run.unitConfig?.skillVersion;
    if (version && !byVersion.has(version)) byVersion.set(version, run);
  });
  const comparable = Array.from(byVersion.values());
  return <>
    <section className="panel compare-picker"><label><span>Skill</span><select value={skillId} onChange={(event) => setSkillId(event.target.value)}>{skills.map((skill) => <option key={skill}>{skill}</option>)}</select></label><span className="compare-arrow">⇢</span><div><strong>Version comparison</strong><small>Defaults to latest vs previous distinct skill version</small></div></section>
    {comparable.length >= 2 ? <RunPairPicker key={skillId} comparable={comparable} unitVersions /> : <section className="panel empty"><strong>Two versions are required</strong><span>{skillId || "This skill"} needs completed runs for at least two distinct skill versions.</span></section>}
  </>;
}

function RunPairPicker({ comparable, unitVersions }: { comparable: EvalRun[]; unitVersions: boolean }) {
  const defaultCandidate = comparable[0];
  const defaultBaseline = comparable[1] ?? comparable[0];
  const [baselineId, setBaselineId] = useState(defaultBaseline.runId);
  const [candidateId, setCandidateId] = useState(defaultCandidate.runId);
  const baseline = comparable.find((run) => run.runId === baselineId)!;
  const candidate = comparable.find((run) => run.runId === candidateId)!;
  const optionLabel = (run: EvalRun) => unitVersions
    ? `v${run.unitConfig?.skillVersion} · ${run.summary.passRatePct}% · ${formatDateShort(run.startedAt)}`
    : `${run.runId} · ${run.target} · ${run.summary.passRatePct}%`;
  return <>
    <section className="panel compare-picker"><label><span>{unitVersions ? "Previous version" : "Baseline run"}</span><select value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>{comparable.map((run) => <option key={run.runId} value={run.runId}>{optionLabel(run)}</option>)}</select></label><span className="compare-arrow">→</span><label><span>{unitVersions ? "Latest version" : "Candidate run"}</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>{comparable.map((run) => <option key={run.runId} value={run.runId}>{optionLabel(run)}</option>)}</select></label></section>
    <ComparisonResults baseline={baseline} candidate={candidate} unitVersions={unitVersions} />
  </>;
}

function ComparisonResults({ baseline, candidate, unitVersions }: { baseline: EvalRun; candidate: EvalRun; unitVersions: boolean }) {
  const passDelta = candidate.summary.passRatePct - baseline.summary.passRatePct;
  const scoreDelta = candidate.summary.meanScore - baseline.summary.meanScore;
  const durationDelta = (candidate.durationMs ?? 0) - (baseline.durationMs ?? 0);
  const suites = Array.from(new Set([...baseline.suites.map((suite) => suite.name), ...candidate.suites.map((suite) => suite.name)]));
  return <>
    <section className="delta-grid"><DeltaCard label="Pass rate" value={`${passDelta >= 0 ? "+" : ""}${passDelta.toFixed(1)}%`} good={passDelta >= 0} detail={`${baseline.summary.passRatePct}% → ${candidate.summary.passRatePct}%`} /><DeltaCard label="Mean score" value={`${scoreDelta >= 0 ? "+" : ""}${scoreDelta.toFixed(2)}`} good={scoreDelta >= 0} detail={`${baseline.summary.meanScore} → ${candidate.summary.meanScore}`} /><DeltaCard label="Duration" value={`${durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(durationDelta))}`} good={durationDelta <= 0} detail={`${formatDuration(baseline.durationMs)} → ${formatDuration(candidate.durationMs)}`} /><DeltaCard label="Failed cases" value={`${candidate.summary.failed - baseline.summary.failed >= 0 ? "+" : ""}${candidate.summary.failed - baseline.summary.failed}`} good={candidate.summary.failed <= baseline.summary.failed} detail={`${baseline.summary.failed} → ${candidate.summary.failed}`} /></section>
    <section className="panel compare-table"><div className="panel-heading"><div><h2>{unitVersions ? "Skill version changes" : "Suite changes"}</h2><p>{unitVersions ? `v${baseline.unitConfig?.skillVersion} → v${candidate.unitConfig?.skillVersion}` : "Mean score and pass rate by suite"}</p></div></div><div className="table-wrap"><table><thead><tr><th>{unitVersions ? "Skill" : "Suite"}</th><th>Baseline score</th><th>Candidate score</th><th>Delta</th><th>Candidate result</th></tr></thead><tbody>{suites.map((name) => { const before=baseline.suites.find((suite)=>suite.name===name); const after=candidate.suites.find((suite)=>suite.name===name); const delta=(after?.meanScore??0)-(before?.meanScore??0); return <tr key={name}><td><strong>{name}</strong></td><td>{before?.meanScore.toFixed(2) ?? "—"}</td><td>{after?.meanScore.toFixed(2) ?? "—"}</td><td><span className={delta>=0?"delta-good":"delta-bad"}>{delta>=0?"+":""}{delta.toFixed(2)}</span></td><td>{after ? `${after.passed}/${after.total} passed` : "Not run"}</td></tr>; })}</tbody></table></div></section>
  </>;
}

function DeltaCard({ label, value, good, detail }: { label: string; value: string; good: boolean; detail: string }) { return <article className="panel delta-card"><span>{label}</span><strong className={good ? "delta-good" : "delta-bad"}>{value}</strong><small>{detail}</small></article>; }

const runRecordExample = `{
  "run_id": "e2e-97a0f7b810",
  "batch_id": "gh-44918",
  "eval_type": "e2e",
  "execution_status": "completed",
  "verdict": "failed",
  "stage": "1-dev-staging",
  "target": "us-east4-dev-staging",
  "e2e_config": {
    "selected_suites": ["navigation", "feedback", "general_inquiry"],
    "max_tier": "all",
    "live_conversation": true
  },
  "trigger": "cli",
  "actor": "artem.kovtunenko",
  "git_sha": "a7c91f2",
  "summary": {
    "total": 8,
    "passed": 7,
    "failed": 1,
    "pass_rate_pct": 87.5,
    "mean_score": 4.25
  }
}`;

const unitRunRecordExample = `{
  "run_id": "unit-fc82d1a640",
  "batch_id": null,
  "eval_type": "unit",
  "execution_status": "completed",
  "verdict": "failed",
  "skill": "feedback-skill",
  "environment": "staging",
  "unit_config": {
    "skill_ids": ["feedback-skill"],
    "bsa_environment": "staging",
    "bsa_version": "1.4.0",
    "skill_version": "1.3.0",
    "mode": "all",
    "metrics": ["tool_use_quality", "general_quality"]
  },
  "summary": {
    "total": 3,
    "passed": 0,
    "failed": 3,
    "pass_rate_pct": 0
  }
}`;

const caseRecordExample = `{
  "case_id": "general_inquiry::pto_balance",
  "run_id": "e2e-97a0f7b810",
  "eval_type": "e2e",
  "suite": "general_inquiry",
  "role": "employee",
  "tier": 3,
  "verdict": "failed",
  "score": 2,
  "threshold": 3,
  "response_time_ms": 32973.53,
  "response_text": "I'm unable to retrieve…",
  "explanation": "Missing product navigation…",
  "bug_ref": "EVAL-1842"
}`;

const unitCaseRecordExample = `{
  "case_id": "feedback-003",
  "run_id": "unit-fc82d1a640",
  "eval_type": "unit",
  "skill": "feedback-skill",
  "test_name": "Handle feedback submission failure",
  "test_type": "single-turn",
  "verdict": "failed",
  "scores": {
    "GENERAL_QUALITY": 1,
    "tool_use_quality": 5
  },
  "tool_calls": [{
    "name": "submit_feedback",
    "parameters": { "feedback_disposition": "thumbs_up" }
  }],
  "skill_version": "1.3.0",
  "bsa_version": "1.4.0"
}`;

function SchemaView() {
  return <>
    <div className="page-heading compact"><div><span className="eyebrow">MongoDB collections</span><h1>Eval runs vs eval cases</h1><p>A run is the execution envelope; cases are the individual scored conversations or skill tests inside it.</p></div></div>
    <section className="relationship"><article className="collection-card"><header><span className="collection-icon">R</span><div><h2>unit_eval_runs · e2e_eval_runs</h2><p>One document per execution</p></div><b>1</b></header><ul><li>Type-specific configuration</li><li>Lifecycle, ownership and source version</li><li>Aggregate verdict and metrics</li><li>Small enough for fast list queries</li></ul></article><div className="relation-line"><strong>1 : N</strong><span>run_id</span></div><article className="collection-card"><header><span className="collection-icon case">C</span><div><h2>unit_eval_cases · e2e_eval_cases</h2><p>One document per evaluated case</p></div><b>N</b></header><ul><li>E2E: one live conversation scenario</li><li>Unit: one mocked skill test and its tool calls</li><li>Metric scores, thresholds and evidence</li><li>Filter and paginate independently</li></ul></article></section>
    <section className="launch-contracts"><article className="contract-card e2e"><TypeBadge type="e2e"/><h3>Target-first run</h3><p>Select a deployed target, then all or a subset of suites enabled by its target manifest.</p></article><article className="contract-card unit"><TypeBadge type="unit"/><h3>Exactly one skill per run</h3><p>A unit run evaluates one skill, its declared tools and one skill version. Compare latest vs previous by default.</p></article></section>
    <section className="schema-grid"><article className="panel code-card"><div className="panel-heading"><div><h2>E2E eval_runs example</h2><p>Live target execution envelope</p></div><span>run</span></div><pre>{runRecordExample}</pre></article><article className="panel code-card"><div className="panel-heading"><div><h2>Unit eval_runs example</h2><p>Mock-backed skill execution envelope</p></div><span>run</span></div><pre>{unitRunRecordExample}</pre></article></section>
    <section className="schema-grid"><article className="panel code-card"><div className="panel-heading"><div><h2>E2E case example</h2><p>GET /api/v1/e2e/runs/:run_id/cases</p></div><span>evidence</span></div><pre>{caseRecordExample}</pre></article><article className="panel code-card"><div className="panel-heading"><div><h2>Unit case example</h2><p>GET /api/v1/unit/runs/:run_id/cases</p></div><span>metrics</span></div><pre>{unitCaseRecordExample}</pre></article></section>
    <section className="panel index-panel"><div className="panel-heading"><div><h2>Recommended indexes</h2><p>Designed for dashboard filters, version history and case drill-down</p></div></div><div className="index-grid"><code>{`e2e_eval_runs: { stage: 1, target: 1, started_at: -1, _id: -1 }`}</code><code>{`unit_eval_runs: { skill: 1, environment: 1, "unit_config.skill_version": 1, started_at: -1 }`}</code><code>{`e2e_eval_cases: { run_id: 1, _id: -1 }`}</code><code>{`unit_eval_cases: { run_id: 1, _id: -1 }`}</code></div></section>
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
      onCreate({ ...common, evalType, stage, target, policyVersion: "gate-v4", datasetVersion: `e2e/${stage}/${target}/target.yaml`, e2eConfig: { kind: "live-target", targetId: target, selectedSuites, maxTier }, suites: selectedSuites.map((name) => ({ name, total: 0, passed: 0, failed: 0, meanScore: 0 })) });
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
