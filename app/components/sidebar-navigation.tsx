"use client";

import Link from "next/link";

import { useAuthorization } from "./authorization-provider";

export type EvaluationView = "overview" | "runs" | "history" | "compare";

export const evaluationNavItems: {
  id: EvaluationView;
  label: string;
  glyph: string;
}[] = [
  { id: "overview", label: "Overview", glyph: "⌂" },
  { id: "runs", label: "Evaluation runs", glyph: "▤" },
  { id: "history", label: "History", glyph: "↗" },
  { id: "compare", label: "Compare", glyph: "⇄" },
];

type SidebarNavigationProps = {
  activeView?: EvaluationView;
  activePath?: string;
  onSelectView?: (view: EvaluationView) => void;
  onNavigate?: () => void;
};

function viewHref(view: EvaluationView) {
  return view === "overview" ? "/" : `/?view=${view}`;
}

export function SidebarNavigation({
  activeView,
  activePath,
  onSelectView,
  onNavigate,
}: SidebarNavigationProps) {
  const { can, loading: authorizationLoading } = useAuthorization();
  const canManageAdministration =
    !authorizationLoading && can("access.manage");

  return (
    <nav aria-label="Main navigation">
      <p>Evaluate</p>
      {evaluationNavItems.map((item) =>
        onSelectView ? (
          <button
            type="button"
            key={item.id}
            className={activeView === item.id ? "active" : ""}
            onClick={() => {
              onSelectView(item.id);
              onNavigate?.();
            }}
          >
            <span>{item.glyph}</span>
            {item.label}
          </button>
        ) : (
          <Link
            key={item.id}
            className="nav-link"
            href={viewHref(item.id)}
            onClick={onNavigate}
          >
            <span>{item.glyph}</span>
            {item.label}
          </Link>
        ),
      )}

      <p>Discover</p>
      <Link
        className={`nav-link ${activePath === "/whats-new" ? "active" : ""}`}
        href="/whats-new"
        onClick={onNavigate}
      >
        <span>✦</span>
        What&apos;s new
        <b className="nav-new">new</b>
      </Link>
      <Link
        className={`nav-link ${activePath === "/suggestions" ? "active" : ""}`}
        href="/suggestions"
        onClick={onNavigate}
      >
        <span>△</span>
        Suggestions
      </Link>

      <p>Access &amp; administration</p>
      <Link
        className={`nav-link ${activePath === "/get-access" ? "active" : ""}`}
        href="/get-access"
        onClick={onNavigate}
      >
        <span>＋</span>
        Request access
      </Link>
      {canManageAdministration && (
        <>
          <Link
            className={`nav-link ${activePath === "/admin/access" ? "active" : ""}`}
            href="/admin/access"
            onClick={onNavigate}
          >
            <span>⚙</span>
            Access management
          </Link>
          <Link
            className={`nav-link ${activePath === "/admin/product-updates" ? "active" : ""}`}
            href="/admin/product-updates"
            onClick={onNavigate}
          >
            <span>✦</span>
            Manage updates
          </Link>
        </>
      )}
      <button disabled title="Policy management is planned">
        <span>⌁</span>
        Policies
        <b className="nav-soon">soon</b>
      </button>
      <button disabled title="Metric management is planned">
        <span>✣</span>
        Custom metrics
        <b className="nav-soon">soon</b>
      </button>
    </nav>
  );
}
