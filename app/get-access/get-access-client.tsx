"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useAuthorization } from "../components/authorization-provider";
import {
  AccessApiError,
  cancelAccessRequest,
  createAccessRequest,
  listMyAccessRequests,
} from "../lib/access-admin-api";
import type {
  AccessRequestRecord,
  EvalHubRole,
} from "../lib/access-admin-types";
import styles from "./get-access.module.css";


const ROLE_DETAILS: Record<EvalHubRole, { label: string; description: string }> = {
  editor: {
    label: "Editor",
    description: "Work with evaluation content and other editor-level product capabilities.",
  },
  admin: {
    label: "Admin",
    description: "Manage EvalHub product configuration and administrative capabilities.",
  },
};

function messageFor(error: unknown): string {
  if (error instanceof AccessApiError) return error.message;
  return "The access request could not be completed.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function GetAccessClient() {
  const { authorization, loading: authorizationLoading } = useAuthorization();
  const [requestedRole, setRequestedRole] = useState<EvalHubRole>("editor");
  const [reason, setReason] = useState("");
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadRequests = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = await listMyAccessRequests(signal);
      setRequests(page.items);
    } catch (loadError) {
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
        setError(messageFor(loadError));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRequests(controller.signal);
    return () => controller.abort();
  }, [loadRequests]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createAccessRequest(requestedRole, reason.trim());
      setReason("");
      setSuccess("Your request was submitted for EvalHub administrator review.");
      await loadRequests();
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(requestId: string) {
    setError(null);
    try {
      await cancelAccessRequest(requestId);
      await loadRequests();
    } catch (cancelError) {
      setError(messageFor(cancelError));
    }
  }

  const roles = authorization?.roles ?? [];
  const alreadyAdmin = roles.includes("admin");
  const alreadyEditor = alreadyAdmin || roles.includes("editor");
  const alreadyHasSelection = requestedRole === "admin" ? alreadyAdmin : alreadyEditor;
  const openForSelection = requests.some(
    (request) => request.requested_role === requestedRole && request.status === "pending",
  );

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>EvalHub access</p>
        <h1>Request access</h1>
        <p className={styles.subtitle}>
          Request an EvalHub role and provide the business reason. Approved access is granted directly by EvalHub.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.card}>
          <h2>New request</h2>
          <form className={styles.form} onSubmit={submit}>
            <fieldset disabled={authorizationLoading || saving}>
              <legend>Requested role</legend>
              {(Object.keys(ROLE_DETAILS) as EvalHubRole[]).map((role) => (
                <label className={requestedRole === role ? styles.selectedRole : styles.role} key={role}>
                  <input type="radio" name="role" value={role} checked={requestedRole === role} onChange={() => setRequestedRole(role)} />
                  <span><strong>{ROLE_DETAILS[role].label}</strong><small>{ROLE_DETAILS[role].description}</small></span>
                </label>
              ))}
            </fieldset>
            <label className={styles.reason}>Business reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe why this access is required for your work." /></label>
            {alreadyHasSelection && <p className={styles.info}>You already have this level of EvalHub access.</p>}
            {openForSelection && <p className={styles.info}>You already have an open request for this role.</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {success && <p className={styles.success} role="status">{success}</p>}
            <button className={styles.primaryButton} type="submit" disabled={saving || reason.trim().length < 10 || alreadyHasSelection || openForSelection}>
              {saving ? "Submitting…" : "Submit request"}
            </button>
          </form>
        </section>

        <section className={styles.card}>
          <h2>My requests</h2>
          {loading ? <p className={styles.muted}>Loading requests…</p> : requests.length === 0 ? <p className={styles.muted}>You have not submitted an access request.</p> : (
            <div className={styles.requestList}>
              {requests.map((request) => (
                <article className={styles.request} key={request._id}>
                  <div><strong>{ROLE_DETAILS[request.requested_role].label}</strong><span className={`${styles.status} ${styles[request.status]}`}>{request.status}</span></div>
                  <p>{request.business_reason}</p>
                  <small>Submitted {formatDate(request.created_at)}</small>
                  {request.decision_note && <small>Decision: {request.decision_note}</small>}
                  {request.status === "pending" && <button className={styles.linkButton} type="button" onClick={() => void cancel(request._id)}>Cancel request</button>}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
