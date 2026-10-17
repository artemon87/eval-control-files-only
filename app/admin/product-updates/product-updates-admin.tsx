"use client";

import { FormEvent, useEffect, useState } from "react";

import { SectionPage } from "../../components/section-page";
import {
  createProductUpdate,
  deleteProductUpdate,
  getProductUpdates,
  type ProductUpdateInput,
  updateProductUpdate,
} from "../../lib/product-updates-api";
import type { ProductUpdate } from "../../lib/product-updates";
import styles from "./product-updates-admin.module.css";

const emptyForm: ProductUpdateInput = {
  status: "shipped",
  releaseDate: new Date().toISOString().slice(0, 10),
  category: "",
  title: "",
  description: "",
  highlights: [],
  image: null,
};

export function ProductUpdatesAdmin() {
  const [items, setItems] = useState<ProductUpdate[]>([]);
  const [form, setForm] = useState<ProductUpdateInput>(emptyForm);
  const [highlightText, setHighlightText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => setItems(await getProductUpdates());
  useEffect(() => {
    const controller = new AbortController();
    void getProductUpdates(controller.signal)
      .then(setItems)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage("Could not load product updates.");
        }
      });
    return () => controller.abort();
  }, []);

  const startEdit = (item: ProductUpdate) => {
    setEditingId(item.id);
    setForm({
      status: item.status,
      releaseDate: item.date,
      category: item.eyebrow,
      title: item.title,
      description: item.description,
      highlights: item.highlights,
      image: null,
    });
    setHighlightText(item.highlights.join("\n"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const input = {
      ...form,
      highlights: highlightText.split("\n").map((value) => value.trim()).filter(Boolean),
    };
    try {
      if (editingId) await updateProductUpdate(editingId, input);
      else await createProductUpdate(input);
      setForm(emptyForm);
      setHighlightText("");
      setEditingId(null);
      await load();
      setMessage(editingId ? "Update saved." : "Update posted to What's New.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionPage
      eyebrow="Content management"
      title="Manage What's New"
      description="Post release notes and roadmap updates. Changes appear immediately."
    >
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.formHeader}><div><h2>{editingId ? "Edit update" : "Post an update"}</h2><p>Keep it concise and focused on the value users receive.</p></div><span>{editingId ? "Editing" : "New"}</span></div>
            <div className={styles.grid}>
              <label>Title<input required minLength={3} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Add screenshots to suggestions" /></label>
              <label>Category<input required maxLength={80} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Suggestions" /></label>
              <label>Release state<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProductUpdateInput["status"] })}><option value="shipped">Shipped</option><option value="coming">Coming next</option><option value="planned">Planned</option></select></label>
              <label>Display date<input required type="date" value={form.releaseDate} onChange={(e) => setForm({ ...form, releaseDate: e.target.value })} /></label>
              <label className={styles.full}>Description<textarea required minLength={10} maxLength={2000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label className={styles.full}>Highlights <small>One per line</small><textarea rows={4} value={highlightText} onChange={(e) => setHighlightText(e.target.value)} placeholder={"Upload PNG, JPEG, or HEIC\nPreview before submitting"} /></label>
              {!editingId && <label className={styles.full}>Screenshot <small>Optional · one image</small><input type="file" accept="image/png,image/jpeg,image/heic,image/heif" onChange={(e) => setForm({ ...form, image: e.target.files?.[0] ?? null })} /></label>}
            </div>
            <div className={styles.actions}>{editingId && <button type="button" className={styles.secondary} onClick={() => { setEditingId(null); setForm(emptyForm); setHighlightText(""); }}>Cancel</button>}<button disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Post update"}</button></div>
            {message && <p className={styles.message} role="status">{message}</p>}
          </form>
          <section className={styles.list}><div><h2>Published updates</h2><span>{items.length} total</span></div>{items.map((item) => <article key={item.id}><div><span>{item.status.replace("coming", "coming next")} · {item.displayDate}</span><h3>{item.title}</h3><p>{item.eyebrow} · {item.description}</p></div><div><button onClick={() => startEdit(item)}>Edit</button><button className={styles.danger} onClick={() => { if (window.confirm(`Delete “${item.title}”?`)) void deleteProductUpdate(item.id).then(load); }}>Delete</button></div></article>)}</section>
    </SectionPage>
  );
}
