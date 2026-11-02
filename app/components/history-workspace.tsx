"use client";

import { useState, type ReactNode } from "react";

/** Shares History navigation while preserving the Trend Explorer mount. */
export function HistoryWorkspace({
  children,
  insights,
  mode,
  onModeChange,
}: {
  children: ReactNode;
  insights?: ReactNode;
  mode?: "trend" | "insights";
  onModeChange?: (mode: "trend" | "insights") => void;
}) {
  const [localView, setLocalView] = useState<"trend" | "insights">("trend");
  const view = mode ?? localView;
  const setView = onModeChange ?? setLocalView;
  return (
    <>
      <div
        className="type-switch"
        role="tablist"
        aria-label="History views"
        style={{ width: "fit-content", marginBottom: 20 }}
      >
        <button
          id="history-insights-tab"
          role="tab"
          aria-controls="history-insights-panel"
          aria-selected={view === "insights"}
          disabled={!insights}
          title={!insights ? "Insights is not available yet." : undefined}
          className={view === "insights" ? "active" : ""}
          onClick={() => setView("insights")}
        >
          Insights
        </button>
        <button
          id="history-trend-tab"
          role="tab"
          aria-controls="history-trend-panel"
          aria-selected={view === "trend"}
          className={view === "trend" ? "active" : ""}
          onClick={() => setView("trend")}
        >
          Trend Explorer
        </button>
      </div>
      <div
        id="history-trend-panel"
        role="tabpanel"
        aria-labelledby="history-trend-tab"
        hidden={view !== "trend"}
      >
        {children}
      </div>
      <div
        id="history-insights-panel"
        role="tabpanel"
        aria-labelledby="history-insights-tab"
        hidden={view !== "insights"}
      >
        {view === "insights" ? insights : null}
      </div>
    </>
  );
}
