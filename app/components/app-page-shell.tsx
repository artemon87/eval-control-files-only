"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { SidebarNavigation } from "./sidebar-navigation";

type AppPageShellProps = {
  activePath: string;
  section: string;
  page: string;
  action?: ReactNode;
  children: ReactNode;
};

export function AppPageShell({
  activePath,
  section,
  page,
  action,
  children,
}: AppPageShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <b aria-hidden="true">UKG</b>
          </span>
          <div>
            <strong>EvalHub</strong>
            <small>Quality operations</small>
          </div>
          {sidebarOpen && (
            <button
              className="sidebar-close"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          )}
        </div>
        <SidebarNavigation
          activePath={activePath}
          onNavigate={() => setSidebarOpen(false)}
        />
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            {section} <span>/</span> {page}
          </div>
          {action && <div className="top-actions">{action}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
