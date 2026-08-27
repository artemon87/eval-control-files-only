"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./suggestions.module.css";

type Suggestion = {
  id: string;
  title: string;
  description: string;
  author: string;
  status: "open" | "planned" | "completed" | "declined";
  vote_count: number;
  created_at: string;
  viewer_has_voted: boolean;
};

export default function SuggestionsPage() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/eval/suggestions?limit=100", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Suggestions API ${response.status}`);
      const payload = await response.json() as { items: Suggestion[] };
      setItems(payload.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load suggestions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/eval/suggestions?limit=100", { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Suggestions API ${response.status}`);
        return response.json() as Promise<{ items: Suggestion[] }>;
      })
      .then((payload) => { setItems(payload.items ?? []); setError(null); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load suggestions");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/eval/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      if (!response.ok) throw new Error(`Suggestions API ${response.status}`);
      setTitle("");
      setDescription("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create suggestion");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVote(item: Suggestion) {
    const response = await fetch(`/api/eval/suggestions/${encodeURIComponent(item.id)}/vote`, {
      method: item.viewer_has_voted ? "DELETE" : "PUT",
    });
    if (!response.ok) {
      setError(`Vote failed (${response.status})`);
      return;
    }
    await load();
  }

  return <main className={styles.page}>
    <header className={styles.heading}><div><span>PRODUCT FEEDBACK</span><h1>Suggestions</h1><p>Propose EvalHub improvements and vote on the work that matters most.</p></div><Link href="/">← Back to EvalHub</Link></header>
    <section className={styles.layout}>
      <form className={styles.form} onSubmit={submit}><h2>Suggest an improvement</h2><label>Title<input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label>Description<textarea rows={7} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} required /></label><button disabled={saving}>{saving ? "Submitting…" : "Submit suggestion"}</button></form>
      <section className={styles.list}><div className={styles.listHeading}><h2>Community priorities</h2><span>{items.length} suggestions</span></div>{error && <div className={styles.error}>{error}</div>}{loading ? <p>Loading suggestions…</p> : items.map((item) => <article key={item.id} className={styles.card}><button className={item.viewer_has_voted ? styles.voted : ""} onClick={() => void toggleVote(item)} aria-label={`${item.viewer_has_voted ? "Remove vote from" : "Vote for"} ${item.title}`}><strong>▲</strong><span>{item.vote_count}</span></button><div><span className={styles.status}>{item.status}</span><h3>{item.title}</h3><p>{item.description}</p><small>Suggested by {item.author} · {new Date(item.created_at).toLocaleDateString()}</small></div></article>)}{!loading && !items.length && <p>No suggestions yet. Add the first one.</p>}</section>
    </section>
  </main>;
}
