"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { SidebarNavigation } from "../components/sidebar-navigation";
import {
  productUpdates,
  type ProductUpdate,
  type ProductUpdateStatus,
} from "../lib/product-updates";
import { getProductUpdates, productUpdateImageUrl } from "../lib/product-updates-api";
import styles from "./whats-new.module.css";

type Filter = "all" | ProductUpdateStatus;

const filterLabels: Record<Filter, string> = {
  all: "All updates",
  shipped: "Shipped",
  coming: "Coming next",
  planned: "Roadmap",
};

const statusLabels: Record<ProductUpdateStatus, string> = {
  shipped: "Shipped",
  coming: "Coming next",
  planned: "Planned",
};

function FeatureVisual({ update }: { update: ProductUpdate }) {
  if (update.image) {
    return (
      <div className={styles.visual} style={{ padding: 0, overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={productUpdateImageUrl(update.id)}
          alt={update.image.filename}
          style={{ display: "block", width: "100%", height: "100%", minHeight: 156, objectFit: "cover" }}
        />
      </div>
    );
  }
  if (update.visual === "access") {
    return (
      <div className={`${styles.visual} ${styles.accessVisual}`} aria-hidden="true">
        <div className={styles.visualTopbar}><i /><i /><i /></div>
        <div className={styles.identityCard}>
          <span>AK</span>
          <div><strong>Authenticated</strong><small>artem@company.com</small></div>
          <b>✓</b>
        </div>
        <div className={styles.roleRow}><span>Viewer</span><span>Editor</span><span>Admin</span></div>
      </div>
    );
  }

  if (update.visual === "suggestions") {
    return (
      <div className={`${styles.visual} ${styles.suggestionVisual}`} aria-hidden="true">
        <div className={styles.uploadBox}><span>＋</span><strong>Add screenshots</strong><small>PNG · JPEG · HEIC</small></div>
        <div className={styles.previewStrip}><i /><i /><i /></div>
      </div>
    );
  }

  return (
    <div className={`${styles.visual} ${styles.roadmapVisual}`} aria-hidden="true">
      <span>Policy</span><i /><span>Metric</span><i /><span>Review</span>
    </div>
  );
}

export default function WhatsNewPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [updates, setUpdates] = useState<ProductUpdate[]>(productUpdates);
  useEffect(() => {
    const controller = new AbortController();
    void getProductUpdates(controller.signal)
      .then((items) => { if (items.length) setUpdates(items); })
      .catch(() => { /* Keep bundled release notes during an API outage. */ });
    return () => controller.abort();
  }, []);
  const visibleUpdates = useMemo(
    () => filter === "all" ? updates : updates.filter((item) => item.status === filter),
    [filter, updates],
  );
  const latest = updates[0] ?? productUpdates[0]!;
  const totals = {
    shipped: updates.filter((item) => item.status === "shipped").length,
    coming: updates.filter((item) => item.status === "coming").length,
    planned: updates.filter((item) => item.status === "planned").length,
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <b aria-hidden="true">UKG</b>
            <Image className="brand-logo" src="/ukg-rgb.png" alt="UKG" width={52} height={34} unoptimized />
          </span>
          <div><strong>EvalHub</strong><small>Quality operations</small></div>
          {sidebarOpen && <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>×</button>}
        </div>
        <SidebarNavigation activePath="/whats-new" onNavigate={() => setSidebarOpen(false)} />
        <div className="sidebar-note">
          <span>Latest release</span>
          <strong><i /> October product update</strong>
          <small>Updated {latest.displayDate}</small>
        </div>
        <div className="profile"><span>AK</span><div><strong>Artem Kovtunenko</strong><small>Evaluation operator</small></div><b>•••</b></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="breadcrumb">EvalHub <span>/</span> What&apos;s new</div>
          <div className="top-actions"><Link className={styles.feedbackLink} href="/suggestions">Share feedback</Link></div>
        </header>

        <div className={styles.content}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <span className={styles.kicker}>PRODUCT UPDATES · OCTOBER 2026</span>
              <h1>See what&apos;s new in EvalHub</h1>
              <p>New capabilities, meaningful improvements, and a clear view of what the team is building next.</p>
              <div className={styles.heroActions}>
                <button onClick={() => setFilter("shipped")}>Explore shipped features</button>
                <Link href="/suggestions">Suggest what comes next →</Link>
              </div>
            </div>
            <div className={styles.heroSummary}>
              <div><strong>{totals.shipped}</strong><span>shipped</span></div>
              <div><strong>{totals.coming}</strong><span>coming next</span></div>
              <div><strong>{totals.planned}</strong><span>on the roadmap</span></div>
            </div>
          </section>

          <div className={styles.toolbar}>
            <div><span>Release notes</span><h2>Latest changes</h2></div>
            <div className={styles.filters} aria-label="Filter product updates">
              {(Object.keys(filterLabels) as Filter[]).map((value) => (
                <button key={value} className={filter === value ? styles.activeFilter : ""} onClick={() => setFilter(value)}>
                  {filterLabels[value]}
                </button>
              ))}
            </div>
          </div>

          <section className={styles.timeline} aria-live="polite">
            {visibleUpdates.map((update) => (
              <article className={styles.updateCard} key={update.id}>
                <div className={styles.dateColumn}><time dateTime={update.date}>{update.displayDate}</time><i /></div>
                <div className={styles.cardBody}>
                  <div className={styles.cardCopy}>
                    <div className={styles.cardMeta}>
                      <span className={`${styles.status} ${styles[update.status]}`}>{statusLabels[update.status]}</span>
                      <span>{update.eyebrow}</span>
                    </div>
                    <h3>{update.title}</h3>
                    <p>{update.description}</p>
                    <ul>{update.highlights.map((highlight) => <li key={highlight}>✓ {highlight}</li>)}</ul>
                  </div>
                  <FeatureVisual update={update} />
                </div>
              </article>
            ))}
          </section>

          <aside className={styles.updateNote}>
            <div><span>How this page works</span><h2>A living product history</h2></div>
            <p>Each feature is marked as shipped, coming next, or planned. Dates for future work are intentionally directional until a release is confirmed.</p>
          </aside>
        </div>
      </main>
    </div>
  );
}
