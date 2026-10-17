"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppPageShell } from "../components/app-page-shell";
import { markSuggestionIdsSeen } from "../lib/suggestion-notifications";
import styles from "./suggestions.module.css";

import {
  getSuggestions,
  getSuggestionManagePermission,
  createSuggestion,
  setSuggestionVote,
  patchSuggestionStatus,
} from "../lib/suggestion-api";


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

type LightboxState = {
  suggestionId: string;
  attachments: SuggestionAttachment[];
  selectedId: string;
};

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUGGESTION_IMAGE_UPLOADS_ENABLED = false;
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
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  //new
  const [updatingStatusId, setUpdatingStatusId] =
    useState<string | null>(null);

  const [canManageSuggestions, setCanManageSuggestions] =
    useState(false);
 //end
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

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const suggestions = await getSuggestions(signal);

      if (signal?.aborted) return;

      setItems(suggestions);

      markSuggestionIdsSeen(
        suggestions.map((item) => item.id),
      );
    } catch (reason) {
      if (!signal?.aborted) {
        setError(
          errorMessage(reason, "Unable to load suggestions"),
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);


  useEffect(() => {
    let cancelled = false;

    async function loadSuggestionAuthorization() {
      try {
        const allowed =
          await getSuggestionManagePermission();

        if (!cancelled) {
          setCanManageSuggestions(allowed);
        }
      } catch {
        if (!cancelled) {
          setCanManageSuggestions(false);
        }
      }
    }

    void loadSuggestionAuthorization();

    return () => {
      cancelled = true;
    };
  }, []);


  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!lightbox) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [lightbox]);

  function addImages(selected: File[]) {
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

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    addImages(selected);
  }

  function dropImages(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingImages(false);

    if (
      !SUGGESTION_IMAGE_UPLOADS_ENABLED ||
      saving ||
      images.length >= MAX_IMAGES
    ) {
      return;
    }

    addImages(Array.from(event.dataTransfer.files));
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

  async function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!title.trim() || !description.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await createSuggestion(
        title.trim(),
        description.trim(),
        images.map((image) => image.file),
      );

      setTitle("");
      setDescription("");

      clearImages();

      await load();
    } catch (reason) {
      setError(
        errorMessage(reason, "Unable to create suggestion"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleVote(item: Suggestion) {
    setError(null);

    try {
      await setSuggestionVote(
        item.id,
        item.viewer_has_voted,
      );

      await load();
    } catch (reason) {
      setError(
        errorMessage(reason, "Unable to update vote"),
      );
    }
  }
  async function updateSuggestionStatus(
    suggestionId: string,
    nextStatus: SuggestionStatus,
  ) {
    setUpdatingStatusId(suggestionId);
    setError(null);

    try {
      const updatedSuggestion =
        await patchSuggestionStatus(
          suggestionId,
          nextStatus,
        );

      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === updatedSuggestion.id
            ? updatedSuggestion
            : item,
        ),
      );
    } catch (reason) {
      setError(
        errorMessage(
          reason,
          "Unable to update suggestion status",
        ),
      );
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <AppPageShell activePath="/suggestions" section="Discover" page="Suggestions">
      <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span>PRODUCT FEEDBACK</span>
          <h1>Suggestions</h1>
          <p>Propose EvalHub improvements and vote on the work that matters most.</p>
        </div>
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
          <div className={styles.uploadField}>
            <div className={styles.uploadLabel}>
              Images <span className={styles.optional}>(optional)</span>
            </div>
            <div
              className={[
                styles.uploadDropzone,
                isDraggingImages ? styles.uploadDropzoneActive : "",
                !SUGGESTION_IMAGE_UPLOADS_ENABLED
                  ? styles.uploadDropzoneDisabled
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="button"
              tabIndex={SUGGESTION_IMAGE_UPLOADS_ENABLED ? 0 : -1}
              aria-disabled={!SUGGESTION_IMAGE_UPLOADS_ENABLED}
              aria-label={
                SUGGESTION_IMAGE_UPLOADS_ENABLED
                  ? "Upload suggestion images"
                  : "Suggestion image uploads are coming soon"
              }
              onClick={() => {
                if (SUGGESTION_IMAGE_UPLOADS_ENABLED) {
                  fileInputRef.current?.click();
                }
              }}
              onKeyDown={(event) => {
                if (
                  SUGGESTION_IMAGE_UPLOADS_ENABLED &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (SUGGESTION_IMAGE_UPLOADS_ENABLED) {
                  setIsDraggingImages(true);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDraggingImages(false)}
              onDrop={dropImages}
            >
              <input
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept="image/png,image/jpeg,image/heic,image/heif,.png,.jpg,.jpeg,.heic,.heif"
                multiple
                onChange={selectImages}
                disabled={
                  !SUGGESTION_IMAGE_UPLOADS_ENABLED ||
                  saving ||
                  images.length >= MAX_IMAGES
                }
              />
              <span className={styles.uploadIcon} aria-hidden="true">
                ↥
              </span>
              <strong>
                {SUGGESTION_IMAGE_UPLOADS_ENABLED
                  ? "Drag and drop images here"
                  : "Image attachments coming soon"}
              </strong>
              <span>
                {SUGGESTION_IMAGE_UPLOADS_ENABLED
                  ? "or click to browse"
                  : "We’re finishing the secure upload setup."}
              </span>
              <small>
                PNG, JPEG, or HEIC/HEIF · Up to 10 MB each · Maximum {MAX_IMAGES}
              </small>
            </div>
          </div>

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
                    {canManageSuggestions ? (
                      <select
                        className={`${styles.statusSelect} ${
                          statusClassNames[item.status]
                        }`}
                        value={item.status}
                        disabled={updatingStatusId === item.id}
                        aria-label={`Update status for ${item.title}`}
                        onChange={(event) =>
                          void updateSuggestionStatus(
                            item.id,
                            event.target.value as SuggestionStatus,
                          )
                        }
                      >
                        <option value="open">Open</option>
                        <option value="planned">Planned</option>
                        <option value="completed">Completed</option>
                        <option value="declined">Declined</option>
                      </select>
                    ) : (
                      <span
                        className={`${styles.status} ${
                          statusClassNames[item.status]
                        }`}
                      >
                        {statusLabels[item.status]}
                      </span>
                    )}
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
                          <button
                            type="button"
                            key={attachment.id}
                            className={styles.attachmentButton}
                            aria-label={`Open ${attachment.filename}`}
                            onClick={() =>
                              setLightbox({
                                suggestionId: item.id,
                                attachments: item.attachments,
                                selectedId: attachment.id,
                              })
                            }
                          >
                            <img src={source} alt={attachment.filename} loading="lazy" />
                          </button>
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
      {lightbox && (() => {
        const selectedIndex = Math.max(
          0,
          lightbox.attachments.findIndex(
            (attachment) => attachment.id === lightbox.selectedId,
          ),
        );

        const selectedAttachment =
          lightbox.attachments[selectedIndex];

        const selectedSource =
          `/api/eval/suggestions/${encodeURIComponent(lightbox.suggestionId)}` +
          `/attachments/${encodeURIComponent(selectedAttachment.id)}`;

        const selectImage = (index: number) => {
          const attachment = lightbox.attachments[index];

          setLightbox({
            ...lightbox,
            selectedId: attachment.id,
          });
        };

        return (
          <div
            className={styles.lightboxBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Suggestion attachments"
            onClick={() => setLightbox(null)}
          >
            <div
              className={styles.lightbox}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.lightboxClose}
                aria-label="Close image viewer"
                onClick={() => setLightbox(null)}
              >
                ×
              </button>

              {lightbox.attachments.length > 1 && (
                <button
                  type="button"
                  className={`${styles.lightboxArrow} ${styles.lightboxPrevious}`}
                  aria-label="Previous image"
                  onClick={() =>
                    selectImage(
                      (selectedIndex - 1 + lightbox.attachments.length) %
                        lightbox.attachments.length,
                    )
                  }
                >
                  ‹
                </button>
              )}

              <img
                className={styles.lightboxImage}
                src={selectedSource}
                alt={selectedAttachment.filename}
              />

              {lightbox.attachments.length > 1 && (
                <button
                  type="button"
                  className={`${styles.lightboxArrow} ${styles.lightboxNext}`}
                  aria-label="Next image"
                  onClick={() =>
                    selectImage(
                      (selectedIndex + 1) %
                        lightbox.attachments.length,
                    )
                  }
                >
                  ›
                </button>
              )}

              <div className={styles.lightboxFooter}>
                <span>{selectedAttachment.filename}</span>

                {lightbox.attachments.length > 1 && (
                  <span>
                    {selectedIndex + 1} / {lightbox.attachments.length}
                  </span>
                )}
              </div>

              {lightbox.attachments.length > 1 && (
                <div className={styles.lightboxThumbnails}>
                  {lightbox.attachments.map((attachment) => {
                    const thumbnailSource =
                      `/api/eval/suggestions/${encodeURIComponent(
                        lightbox.suggestionId,
                      )}/attachments/${encodeURIComponent(attachment.id)}`;

                    return (
                      <button
                        type="button"
                        key={attachment.id}
                        className={
                          attachment.id === lightbox.selectedId
                            ? styles.lightboxThumbnailActive
                            : styles.lightboxThumbnail
                        }
                        onClick={() =>
                          setLightbox({
                            ...lightbox,
                            selectedId: attachment.id,
                          })
                        }
                      >
                        <img
                          src={thumbnailSource}
                          alt={attachment.filename}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </div>
    </AppPageShell>
  );
}
