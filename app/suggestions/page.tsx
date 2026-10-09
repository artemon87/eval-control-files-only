"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { markSuggestionIdsSeen } from "../lib/suggestion-notifications";
import styles from "./suggestions.module.css";

type SuggestionStatus = "open" | "planned" | "completed" | "declined";
type StatusFilter = "all" | SuggestionStatus;

type SuggestionAttachment = {
  id: string;
  filename: string;
  content_type: "image/png" | "image/jpeg";
  size_bytes: number;
};

type Suggestion = {
  id: string;
  title: string;
  description: string;
  author: string;
  status: SuggestionStatus;
  vote_count: number;
  created_at: string;
  attachments: SuggestionAttachment[];
  viewer_has_voted: boolean;
};

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string | null;
};

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
]);
const HEIC_EXTENSIONS = [".heic", ".heif"];

const statusLabels: Record<SuggestionStatus, string> = {
  open: "Open",
  planned: "Planned",
  completed: "Completed",
  declined: "Declined",
};

const statusDescriptions: Record<SuggestionStatus, string> = {
  open: "Collecting feedback",
  planned: "Accepted for future work",
  completed: "Delivered",
  declined: "Not planned",
};

const statusClassNames: Record<SuggestionStatus, string> = {
  open: styles.statusOpen,
  planned: styles.statusPlanned,
  completed: styles.statusCompleted,
  declined: styles.statusDeclined,
};

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function isAcceptedImage(file: File): boolean {
  if (ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) return true;
  const name = file.name.toLowerCase();
  return (
    (file.type === "" || file.type === "application/octet-stream") &&
    HEIC_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

export default function SuggestionsPage() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());

  const statusCounts = useMemo(
    () =>
      items.reduce<Record<SuggestionStatus, number>>(
        (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
        { open: 0, planned: 0, completed: 0, declined: 0 },
      ),
    [items],
  );

  const visibleItems = useMemo(
    () => (statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter)),
    [items, statusFilter],
  );

  const pipelineFilters = useMemo(
    () => [
      { value: "all" as const, label: "All", count: items.length, className: styles.statusAll },
      ...(["open", "planned", "completed", "declined"] as const).map((value) => ({
        value,
        label: statusLabels[value],
        count: statusCounts[value],
        className: statusClassNames[value],
      })),
    ],
    [items.length, statusCounts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/eval/suggestions?limit=100", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Suggestions API ${response.status}`);
      const payload = (await response.json()) as { items: Suggestion[] };
      const suggestions = payload.items ?? [];
      setItems(suggestions);
      markSuggestionIdsSeen(suggestions.map((item) => item.id));
    } catch (reason) {
      setError(errorMessage(reason, "Unable to load suggestions"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/eval/suggestions?limit=100", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Suggestions API ${response.status}`);
        return response.json() as Promise<{ items: Suggestion[] }>;
      })
      .then((payload) => {
        const suggestions = payload.items ?? [];
        setItems(suggestions);
        markSuggestionIdsSeen(suggestions.map((item) => item.id));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason, "Unable to load suggestions"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    },
    [],
  );

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError(null);

    if (images.length + selected.length > MAX_IMAGES) {
      setError(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }

    const invalidType = selected.find((file) => !isAcceptedImage(file));
    if (invalidType) {
      setError(`${invalidType.name} must be a PNG, JPEG, HEIC, or HEIF image.`);
      return;
    }

    const tooLarge = selected.find((file) => file.size > MAX_IMAGE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} exceeds 10 MB.`);
      return;
    }

    const additions = selected.map((file) => {
      const previewUrl = file.type === "image/png" || file.type === "image/jpeg"
        ? URL.createObjectURL(file)
        : null;
      if (previewUrl) objectUrlsRef.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, previewUrl };
    });
    setImages((current) => [...current, ...additions]);
  }

  function removeImage(id: string) {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
        objectUrlsRef.current.delete(removed.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
  }

  function clearImages() {
    images.forEach((image) => {
      if (image.previewUrl) {
        URL.revokeObjectURL(image.previewUrl);
        objectUrlsRef.current.delete(image.previewUrl);
      }
    });
    setImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    images.forEach(({ file }) => formData.append("images", file, file.name));

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/eval/suggestions", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? `Suggestions API ${response.status}`);
      }
      setTitle("");
      setDescription("");
      clearImages();
      await load();
    } catch (reason) {
      setError(errorMessage(reason, "Unable to create suggestion"));
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

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span>PRODUCT FEEDBACK</span>
          <h1>Suggestions</h1>
          <p>Propose EvalHub improvements and vote on the work that matters most.</p>
        </div>
        <nav className={styles.pageNav} aria-label="Page navigation">
          <Link href="/">← Back to EvalHub</Link>
        </nav>
      </header>

      <section className={styles.layout}>
        <form className={styles.form} onSubmit={submit} encType="multipart/form-data">
          <h2>Suggest an improvement</h2>
          <label>
            Title
            <input
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
          <label>
            Description
            <textarea
              rows={7}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </label>
          <label>
            Images <span className={styles.optional}>(optional)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/heic,image/heif,.png,.jpg,.jpeg,.heic,.heif"
              multiple
              onChange={selectImages}
              disabled={saving || images.length >= MAX_IMAGES}
            />
            <small>PNG, JPEG, or HEIC/HEIF, up to 10 MB each, maximum {MAX_IMAGES}.</small>
          </label>

          {images.length > 0 && (
            <div className={styles.selectedImages} aria-label="Selected image previews">
              {images.map((image) => (
                <div className={styles.selectedImage} key={image.id}>
                  {image.previewUrl ? (
                    <img src={image.previewUrl} alt={`Preview of ${image.file.name}`} />
                  ) : (
                    <span className={styles.heicPlaceholder}>
                      <strong>HEIC</strong>
                      <small>{image.file.name}</small>
                    </span>
                  )}
                  <button type="button" onClick={() => removeImage(image.id)} aria-label={`Remove ${image.file.name}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button disabled={saving}>{saving ? "Submitting…" : "Submit suggestion"}</button>
        </form>

        <section className={styles.list}>
          <div className={styles.listHeading}>
            <div>
              <h2>Community priorities</h2>
              <span>{items.length} total suggestions</span>
            </div>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "↻ Refresh statuses"}
            </button>
          </div>

          <div className={styles.pipeline} aria-label="Suggestion status filters">
            {pipelineFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={[
                  styles.pipelineItem,
                  filter.className,
                  statusFilter === filter.value ? styles.pipelineActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={statusFilter === filter.value}
              >
                <span>{filter.label}</span>
                <strong>{filter.count}</strong>
              </button>
            ))}
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {loading ? (
            <p>Loading suggestions…</p>
          ) : (
            visibleItems.map((item) => (
              <article key={item.id} className={styles.card}>
                <button
                  type="button"
                  className={item.viewer_has_voted ? styles.voted : ""}
                  onClick={() => void toggleVote(item)}
                  aria-label={`${item.viewer_has_voted ? "Remove vote from" : "Vote for"} ${item.title}`}
                >
                  <strong>▲</strong>
                  <span>{item.vote_count}</span>
                </button>
                <div>
                  <div className={styles.cardStatus}>
                    <span className={`${styles.status} ${statusClassNames[item.status]}`}>
                      {statusLabels[item.status]}
                    </span>
                    <small>{statusDescriptions[item.status]}</small>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>

                  {item.attachments?.length > 0 && (
                    <div className={styles.attachmentGrid}>
                      {item.attachments.map((attachment) => {
                        const source =
                          `/api/eval/suggestions/${encodeURIComponent(item.id)}` +
                          `/attachments/${encodeURIComponent(attachment.id)}`;
                        return (
                          <a key={attachment.id} href={source} target="_blank" rel="noreferrer">
                            <img src={source} alt={attachment.filename} loading="lazy" />
                          </a>
                        );
                      })}
                    </div>
                  )}

                  <small>
                    Suggested by {item.author} · {new Date(item.created_at).toLocaleDateString()}
                  </small>
                </div>
              </article>
            ))
          )}

          {!loading && visibleItems.length === 0 && (
            <p className={styles.empty}>
              {statusFilter === "all"
                ? "No suggestions yet. Add the first one."
                : `No ${statusLabels[statusFilter].toLowerCase()} suggestions.`}
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
