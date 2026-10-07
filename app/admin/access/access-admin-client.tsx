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
  EvalHubRole,
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
    if (error.status === 403) return "EvalHub administrator access is required.";
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
            EvalHub owns application roles and permissions. Microsoft Entra is used only to identify signed-in users.
          </p>
        </div>
      </header>

      <section className={styles.notice} aria-label="Authorization information">
        <strong>EvalHub is the authorization source of truth.</strong>
        <span>
          Role changes take effect on the next backend authorization check.
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
                  ? "Assignments"
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
          <thead><tr><th>User</th><th>EvalHub roles</th><th>Permissions</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={5} /> : users.length === 0 ? (
              <EmptyRow columns={5} message="No users match this search." />
            ) : users.map((user) => {
              const activeAssignments = user.assignments.filter((assignment) => assignment.status === "active");
              return (
                <tr key={`${user.tenant_id}:${user.principal_id}`}>
                  <td><UserIdentity user={user} /></td>
                  <td><RoleBadges roles={user.roles} /></td>
                  <td>{user.effective_permissions.length ? user.effective_permissions.join(", ") : <span className={styles.muted}>None</span>}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td className={styles.actions}>
                    {user.principal_id !== currentPrincipalId && user.roles.length < 2 && (
                      <button className={styles.primaryButton} type="button" onClick={() => onAssign(user)}>
                        Assign role
                      </button>
                    )}
                    {activeAssignments.length === 1 && user.principal_id !== currentPrincipalId && (
                      <button className={styles.dangerButton} type="button" onClick={() => onRevoke(activeAssignments[0])}>Revoke</button>
                    )}
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
        <div><h2>EvalHub access requests</h2><p>Approving a request grants the selected EvalHub role immediately.</p></div>
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
                <td><span className={styles.entraBadge}>{request.requested_role}</span></td>
                <td className={styles.reasonCell}>{request.business_reason}</td>
                <td><StatusBadge status={request.status} /></td>
                <td>{formatDate(request.created_at)}</td>
                <td className={styles.actions}>
                  {request.status === "pending" && (
                    <><button className={styles.primaryButton} type="button" onClick={() => onDecision(request, "approve")}>Approve</button>{" "}<button className={styles.dangerButton} type="button" onClick={() => onDecision(request, "reject")}>Reject</button></>
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
      <div className={styles.toolbar}><div><h2>Role assignments</h2><p>Current and historical EvalHub access.</p></div></div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>User</th><th>Status</th><th>Granted</th><th>Expires</th><th>Reason</th><th /></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={6} /> : assignments.length === 0 ? (
              <EmptyRow columns={6} message="No EvalHub role assignments exist." />
            ) : assignments.map((assignment) => {
              const user = users.get(assignment.principal_id);
              return (
                <tr key={assignment._id}>
                  <td><strong>{user?.display_name ?? assignment.principal_id}</strong><small className={styles.block}>{user?.email}</small></td>
                  <td><span className={styles.assignmentChip}>{assignment.local_role}</span><StatusBadge status={assignment.status} /></td>
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
                <td>{event.requested_role ?? event.local_role ?? "—"}</td>
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

function RoleBadges({ roles }: { roles: EvalHubRole[] }) {
  return <div className={styles.stack}>{roles.length ? roles.map((role) => <span className={styles.entraBadge} key={role}>{role}</span>) : <span className={styles.muted}>No role assigned</span>}</div>;
}

function AssignmentDialog({ user, onClose, onSaved }: { user: AccessUser; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<EvalHubRole>(user.roles.includes("editor") ? "admin" : "editor");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await createAssignment({ tenant_id: user.tenant_id, principal_id: user.principal_id, local_role: role, scope: { type: "global", id: "*" }, reason: reason.trim(), expires_at: expiresAt ? new Date(expiresAt).toISOString() : null });
      await onSaved();
    } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); }
  }
  return <Dialog title={`Assign a role to ${user.display_name}`} eyebrow="EvalHub access" onClose={onClose}>
    <form onSubmit={submit} className={styles.form}>
      <p>The role is stored and enforced by EvalHub. No Entra app role is required.</p>
      <label>Role<select value={role} onChange={(event) => setRole(event.target.value as EvalHubRole)}>{!user.roles.includes("editor") && <option value="editor">Editor</option>}{!user.roles.includes("admin") && <option value="admin">Admin</option>}</select></label>
      <label>Expiration (optional)<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
      <label>Business reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <DialogActions onClose={onClose} saving={saving} disabled={reason.trim().length < 5} action="Assign role" />
    </form>
  </Dialog>;
}

function RevokeDialog({ assignment, onClose, onRevoked }: { assignment: AssignmentRecord; onClose: () => void; onRevoked: () => Promise<void> }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(null); try { await revokeAssignment(assignment._id, reason.trim()); await onRevoked(); } catch (revokeError) { setError(errorMessage(revokeError)); } finally { setSaving(false); } }
  return <Dialog title={`Revoke ${assignment.local_role} role?`} eyebrow="Confirm revocation" onClose={onClose}><form onSubmit={submit} className={styles.form}><p>This takes effect on the next authorization check.</p><label>Revocation reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<DialogActions onClose={onClose} saving={saving} disabled={reason.trim().length < 5} action="Revoke access" danger /></form></Dialog>;
}

function DecisionDialog({ request, action, onClose, onSaved }: { request: AccessRequestRecord; action: AccessRequestAction; onClose: () => void; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const title = action === "approve" ? "Approve access request?" : "Reject access request?";
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(null); try { await decideAccessRequest(request._id, action, note.trim()); await onSaved(); } catch (decisionError) { setError(errorMessage(decisionError)); } finally { setSaving(false); } }
  return <Dialog title={title} eyebrow="EvalHub access request" onClose={onClose}><form onSubmit={submit} className={styles.form}><p><strong>{request.display_name}</strong> requested {request.requested_role}.</p>{action === "approve" && <p>Approval grants this EvalHub role immediately.</p>}<label>Decision note<textarea required minLength={5} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<DialogActions onClose={onClose} saving={saving} disabled={note.trim().length < 5} action={`${action.charAt(0).toUpperCase()}${action.slice(1)} request`} danger={action === "reject"} /></form></Dialog>;
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
