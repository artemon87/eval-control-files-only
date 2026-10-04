"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  AccessApiError,
  createAssignment,
  decideAccessRequest,
  listAccessUsers,
  listAdminAccessRequests,
  listAssignments,
  listAuditEvents,
  revokeAssignment,
} from "../../lib/access-admin-api";
import type {
  AccessRequestAction,
  AccessRequestRecord,
  AccessUser,
  AssignmentRecord,
  AuditEvent,
} from "../../lib/access-admin-types";
import styles from "./access-admin.module.css";


type Tab = "users" | "requests" | "assignments" | "audit";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof AccessApiError) {
    if (error.status === 403) return "Platform administrator access is required.";
    return error.message;
  }
  return "Something went wrong while loading access administration.";
}

export function AccessAdminClient({ currentPrincipalId }: { currentPrincipalId: string }) {
  const [tab, setTab] = useState<Tab>("requests");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [requests, setRequests] = useState<AccessRequestRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignUser, setAssignUser] = useState<AccessUser | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AssignmentRecord | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{
    request: AccessRequestRecord;
    action: AccessRequestAction;
  } | null>(null);

  const loadData = useCallback(async (query: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [usersPage, requestsPage, assignmentsPage, auditPage] = await Promise.all([
        listAccessUsers(query, signal),
        listAdminAccessRequests(undefined, signal),
        listAssignments(false, signal),
        listAuditEvents(signal),
      ]);
      setUsers(usersPage.items);
      setRequests(requestsPage.items);
      setAssignments(assignmentsPage.items);
      setAuditEvents(auditPage.items);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(errorMessage(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadData(search, controller.signal), 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadData, search]);

  const userLookup = useMemo(
    () => new Map(users.map((user) => [user.principal_id, user])),
    [users],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Administration</p>
          <h1>Access management</h1>
          <p className={styles.subtitle}>
            Entra owns product roles. EvalHub stores only the additional platform-admin assignment.
          </p>
        </div>
        <a
          className={styles.externalLink}
          href={process.env.NEXT_PUBLIC_ENTRA_ENTERPRISE_APP_URL ?? "https://entra.microsoft.com"}
          target="_blank"
          rel="noreferrer"
        >
          Manage Entra assignments ↗
        </a>
      </header>

      <section className={styles.notice} aria-label="Authorization information">
        <strong>Entra is the source of truth.</strong>
        <span>
          Approving a request records the decision; access starts only after its Entra assignment is completed.
        </span>
      </section>

      <nav className={styles.tabs} aria-label="Access administration sections">
        {(["users", "requests", "assignments", "audit"] as const).map((item) => (
          <button
            className={tab === item ? styles.activeTab : styles.tab}
            key={item}
            onClick={() => setTab(item)}
            type="button"
          >
            {item === "users"
              ? "Users"
              : item === "requests"
                ? `Requests${requests.filter((request) => request.status === "pending").length ? ` (${requests.filter((request) => request.status === "pending").length})` : ""}`
                : item === "assignments"
                  ? "Platform admins"
                  : "Audit"}
          </button>
        ))}
      </nav>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadData(search)}>Retry</button>
        </div>
      )}

      {tab === "users" && (
        <UsersTab
          users={users}
          loading={loading}
          search={search}
          currentPrincipalId={currentPrincipalId}
          onSearch={setSearch}
          onAssign={setAssignUser}
          onRevoke={setRevokeTarget}
        />
      )}
      {tab === "requests" && (
        <RequestsTab
          requests={requests}
          loading={loading}
          onDecision={(request, action) => setDecisionTarget({ request, action })}
        />
      )}
      {tab === "assignments" && (
        <AssignmentsTab
          assignments={assignments}
          users={userLookup}
          loading={loading}
          currentPrincipalId={currentPrincipalId}
          onRevoke={setRevokeTarget}
        />
      )}
      {tab === "audit" && <AuditTab events={auditEvents} loading={loading} />}

      {assignUser && (
        <AssignmentDialog
          user={assignUser}
          onClose={() => setAssignUser(null)}
          onSaved={async () => {
            setAssignUser(null);
            await loadData(search);
          }}
        />
      )}
      {revokeTarget && (
        <RevokeDialog
          assignment={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={async () => {
            setRevokeTarget(null);
            await loadData(search);
          }}
        />
      )}
      {decisionTarget && (
        <DecisionDialog
          {...decisionTarget}
          onClose={() => setDecisionTarget(null)}
          onSaved={async () => {
            setDecisionTarget(null);
            await loadData(search);
          }}
        />
      )}
    </main>
  );
}

function UsersTab({ users, loading, search, currentPrincipalId, onSearch, onAssign, onRevoke }: {
  users: AccessUser[];
  loading: boolean;
  search: string;
  currentPrincipalId: string;
  onSearch: (value: string) => void;
  onAssign: (user: AccessUser) => void;
  onRevoke: (assignment: AssignmentRecord) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div><h2>Known EvalHub users</h2><p>Users appear after their first successful sign-in.</p></div>
        <label className={styles.search}>
          <span className={styles.srOnly}>Search users</span>
          <input type="search" placeholder="Search name or email" value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>User</th><th>Entra role</th><th>Platform admin</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={5} /> : users.length === 0 ? (
              <EmptyRow columns={5} message="No users match this search." />
            ) : users.map((user) => {
              const activeAssignment = user.assignments.find((assignment) => assignment.status === "active");
              return (
                <tr key={`${user.tenant_id}:${user.principal_id}`}>
                  <td><UserIdentity user={user} /></td>
                  <td><RoleBadges roles={user.entra_roles_last_seen} confirmedAt={user.entra_roles_last_confirmed_at} /></td>
                  <td>{activeAssignment ? <span className={styles.assignmentChip}>Platform admin</span> : <span className={styles.muted}>No</span>}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td className={styles.actions}>
                    {!activeAssignment ? (
                      <button className={styles.primaryButton} type="button" disabled={user.principal_id === currentPrincipalId || !user.entra_roles_last_seen.includes("EvalHub.Admin")} onClick={() => onAssign(user)}>
                        Make platform admin
                      </button>
                    ) : user.principal_id !== currentPrincipalId ? (
                      <button className={styles.dangerButton} type="button" onClick={() => onRevoke(activeAssignment)}>Revoke</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequestsTab({ requests, loading, onDecision }: {
  requests: AccessRequestRecord[];
  loading: boolean;
  onDecision: (request: AccessRequestRecord, action: AccessRequestAction) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div><h2>Entra access requests</h2><p>Review requests, then complete approved assignments in Microsoft Entra.</p></div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Requester</th><th>Requested role</th><th>Business reason</th><th>Status</th><th>Requested</th><th /></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={6} /> : requests.length === 0 ? (
              <EmptyRow columns={6} message="No access requests have been submitted." />
            ) : requests.map((request) => (
              <tr key={request._id}>
                <td><strong>{request.display_name}</strong><small className={styles.block}>{request.email ?? request.principal_id}</small></td>
                <td><span className={styles.entraBadge}>{request.requested_role.replace("EvalHub.", "")}</span></td>
                <td className={styles.reasonCell}>{request.business_reason}</td>
                <td><StatusBadge status={request.status} /></td>
                <td>{formatDate(request.created_at)}</td>
                <td className={styles.actions}>
                  {request.status === "pending" && (
                    <><button className={styles.primaryButton} type="button" onClick={() => onDecision(request, "approve")}>Approve</button>{" "}<button className={styles.dangerButton} type="button" onClick={() => onDecision(request, "reject")}>Reject</button></>
                  )}
                  {request.status === "approved" && (
                    <button className={styles.primaryButton} type="button" onClick={() => onDecision(request, "fulfill")}>Mark fulfilled</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignmentsTab({ assignments, users, loading, currentPrincipalId, onRevoke }: {
  assignments: AssignmentRecord[];
  users: Map<string, AccessUser>;
  loading: boolean;
  currentPrincipalId: string;
  onRevoke: (assignment: AssignmentRecord) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}><div><h2>Platform administrators</h2><p>Current and historical exceptional platform access.</p></div></div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>User</th><th>Status</th><th>Granted</th><th>Expires</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={6} /> : assignments.length === 0 ? (
              <EmptyRow columns={6} message="No platform-admin assignments exist." />
            ) : assignments.map((assignment) => {
              const user = users.get(assignment.principal_id);
              return (
                <tr key={assignment._id}>
                  <td><strong>{user?.display_name ?? assignment.principal_id}</strong><small className={styles.block}>{user?.email}</small></td>
                  <td><StatusBadge status={assignment.status} /></td>
                  <td>{formatDate(assignment.created_at)}<small className={styles.block}>by {assignment.granted_by.display_name ?? assignment.granted_by.principal_id}</small></td>
                  <td>{formatDate(assignment.expires_at)}</td>
                  <td className={styles.reasonCell}>{assignment.reason}</td>
                  <td className={styles.actions}>{assignment.status === "active" && assignment.principal_id !== currentPrincipalId && <button className={styles.dangerButton} type="button" onClick={() => onRevoke(assignment)}>Revoke</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditTab({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}><div><h2>Authorization audit</h2><p>Append-only platform assignment and request history.</p></div></div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Access</th><th>Reason</th></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={6} /> : events.length === 0 ? <EmptyRow columns={6} message="No authorization events recorded." /> : events.map((event) => (
              <tr key={event._id}>
                <td>{formatDate(event.occurred_at)}</td><td>{event.event_type.split(".").at(-1)}</td>
                <td>{event.actor.display_name ?? event.actor.principal_id}</td><td>{event.target.display_name ?? event.target.principal_id}</td>
                <td>{event.requested_role?.replace("EvalHub.", "") ?? (event.local_role ? "Platform admin" : "—")}</td>
                <td className={styles.reasonCell}>{event.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserIdentity({ user }: { user: AccessUser }) {
  return <div className={styles.userCell}><span className={styles.avatar} aria-hidden="true">{user.display_name.charAt(0).toUpperCase()}</span><span><strong>{user.display_name}</strong><small>{user.email ?? user.principal_id}</small></span></div>;
}

function RoleBadges({ roles, confirmedAt }: { roles: string[]; confirmedAt: string }) {
  return <div className={styles.stack}>{roles.length ? roles.map((role) => <span className={styles.entraBadge} key={role}>{role.replace("EvalHub.", "")}</span>) : <span className={styles.muted}>No role observed</span>}<small>Confirmed {formatDate(confirmedAt)}</small></div>;
}

function AssignmentDialog({ user, onClose, onSaved }: { user: AccessUser; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await createAssignment({ tenant_id: user.tenant_id, principal_id: user.principal_id, local_role: "platform_admin", scope: { type: "global", id: "*" }, reason: reason.trim(), expires_at: expiresAt ? new Date(expiresAt).toISOString() : null });
      await onSaved();
    } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); }
  }
  return <Dialog title={`Make ${user.display_name} a platform admin`} eyebrow="Exceptional access" onClose={onClose}>
    <form onSubmit={submit} className={styles.form}>
      <p>This adds only EvalHub platform administration. The user must already have Entra Admin.</p>
      <label>Expiration (optional)<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <label>Business reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <DialogActions onClose={onClose} saving={saving} disabled={reason.trim().length < 5} action="Assign platform admin" />
    </form>
  </Dialog>;
}

function RevokeDialog({ assignment, onClose, onRevoked }: { assignment: AssignmentRecord; onClose: () => void; onRevoked: () => Promise<void> }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(null); try { await revokeAssignment(assignment._id, reason.trim()); await onRevoked(); } catch (revokeError) { setError(errorMessage(revokeError)); } finally { setSaving(false); } }
  return <Dialog title="Revoke platform administrator?" eyebrow="Confirm revocation" onClose={onClose}><form onSubmit={submit} className={styles.form}><p>This takes effect on the next authorization check.</p><label>Revocation reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<DialogActions onClose={onClose} saving={saving} disabled={reason.trim().length < 5} action="Revoke access" danger /></form></Dialog>;
}

function DecisionDialog({ request, action, onClose, onSaved }: { request: AccessRequestRecord; action: AccessRequestAction; onClose: () => void; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const title = action === "approve" ? "Approve access request?" : action === "fulfill" ? "Mark request fulfilled?" : "Reject access request?";
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(null); try { await decideAccessRequest(request._id, action, note.trim()); await onSaved(); } catch (decisionError) { setError(errorMessage(decisionError)); } finally { setSaving(false); } }
  return <Dialog title={title} eyebrow="Entra access request" onClose={onClose}><form onSubmit={submit} className={styles.form}><p><strong>{request.display_name}</strong> requested {request.requested_role.replace("EvalHub.", "")}.</p>{action === "fulfill" && <p>Confirm that the role was assigned in Microsoft Entra before continuing.</p>}<label>Decision note<textarea required minLength={5} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<DialogActions onClose={onClose} saving={saving} disabled={note.trim().length < 5} action={action === "fulfill" ? "Confirm fulfilled" : `${action.charAt(0).toUpperCase()}${action.slice(1)} request`} danger={action === "reject"} /></form></Dialog>;
}

function Dialog({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}><div className={styles.dialogHeader}><div><p className={styles.eyebrow}>{eyebrow}</p><h2>{title}</h2></div><button className={styles.closeButton} type="button" aria-label="Close" onClick={onClose}>×</button></div>{children}</section></div>;
}

function DialogActions({ onClose, saving, disabled, action, danger = false }: { onClose: () => void; saving: boolean; disabled: boolean; action: string; danger?: boolean }) {
  return <div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={danger ? styles.dangerButton : styles.primaryButton} disabled={saving || disabled}>{saving ? "Saving…" : action}</button></div>;
}

function StatusBadge({ status }: { status: string }) { return <span className={`${styles.status} ${styles[status]}`}>{status}</span>; }
function LoadingRows({ columns }: { columns: number }) { return <>{[0, 1, 2].map((value) => <tr key={value}><td colSpan={columns}><span className={styles.skeleton} /></td></tr>)}</>; }
function EmptyRow({ columns, message }: { columns: number; message: string }) { return <tr><td className={styles.empty} colSpan={columns}>{message}</td></tr>; }
