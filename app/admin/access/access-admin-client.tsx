"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  AccessApiError,
  createAssignment,
  listAccessUsers,
  listAssignments,
  listAuditEvents,
  revokeAssignment,
} from "../../lib/access-admin-api";
import type {
  AccessUser,
  AssignmentRecord,
  AuditEvent,
  PlatformRole,
  ScopeType,
} from "../../lib/access-admin-types";
import styles from "./access-admin.module.css";


type Tab = "users" | "assignments" | "audit";

const ROLE_LABELS: Record<PlatformRole, string> = {
  moderator: "Moderator",
  evaluation_admin: "Evaluation admin",
  platform_admin: "Platform admin",
};

const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  moderator: "Moderate community suggestions.",
  evaluation_admin: "Override runs and manage evaluation policy and metrics.",
  platform_admin: "Manage platform assignments and view authorization audit history.",
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof AccessApiError) {
    if (error.status === 403) {
      return "You do not have the access.manage platform permission.";
    }
    return error.message;
  }
  return "Something went wrong while loading access administration.";
}

export function AccessAdminClient({
  currentPrincipalId,
}: {
  currentPrincipalId: string;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignUser, setAssignUser] = useState<AccessUser | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AssignmentRecord | null>(null);

  const loadData = useCallback(async (query: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [usersPage, assignmentsPage, auditPage] = await Promise.all([
        listAccessUsers(query, signal),
        listAssignments(false, signal),
        listAuditEvents(signal),
      ]);
      setUsers(usersPage.items);
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
    const timeout = window.setTimeout(() => {
      void loadData(search, controller.signal);
    }, 250);
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
            Entra roles are read-only context. Platform assignments are managed by EvalHub.
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
        <strong>Two layers protect privileged actions.</strong>
        <span>
          A valid Entra role and an active platform assignment are both required.
        </span>
      </section>

      <nav className={styles.tabs} aria-label="Access administration sections">
        {(["users", "assignments", "audit"] as const).map((item) => (
          <button
            className={tab === item ? styles.activeTab : styles.tab}
            key={item}
            onClick={() => setTab(item)}
            type="button"
          >
            {item === "users" ? "Users" : item === "assignments" ? "Platform assignments" : "Audit"}
          </button>
        ))}
      </nav>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadData(search)}>
            Retry
          </button>
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
    </main>
  );
}

function UsersTab({
  users,
  loading,
  search,
  currentPrincipalId,
  onSearch,
  onAssign,
  onRevoke,
}: {
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
        <div>
          <h2>Known EvalHub users</h2>
          <p>Users appear after their first successful sign-in.</p>
        </div>
        <label className={styles.search}>
          <span className={styles.srOnly}>Search users</span>
          <input
            type="search"
            placeholder="Search name or email"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Entra role</th>
              <th>Platform assignments</th>
              <th>Last login</th>
              <th><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRows columns={5} />
            ) : users.length === 0 ? (
              <EmptyRow columns={5} message="No users match this search." />
            ) : (
              users.map((user) => (
                <tr key={`${user.tenant_id}:${user.principal_id}`}>
                  <td>
                    <div className={styles.userCell}>
                      <span className={styles.avatar} aria-hidden="true">
                        {user.display_name.charAt(0).toUpperCase()}
                      </span>
                      <span>
                        <strong>{user.display_name}</strong>
                        <small>{user.email ?? user.principal_id}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.stack}>
                      {user.entra_roles_last_seen.length ? (
                        user.entra_roles_last_seen.map((role) => (
                          <span className={styles.entraBadge} key={role}>{role.replace("EvalHub.", "")}</span>
                        ))
                      ) : (
                        <span className={styles.muted}>No role observed</span>
                      )}
                      <small>Confirmed {formatDate(user.entra_roles_last_confirmed_at)}</small>
                    </div>
                  </td>
                  <td>
                    <div className={styles.assignmentList}>
                      {user.assignments.length ? (
                        user.assignments.map((assignment) => (
                          <span className={styles.assignmentChip} key={assignment._id}>
                            {ROLE_LABELS[assignment.local_role]}
                            {user.principal_id !== currentPrincipalId && (
                              <button
                                type="button"
                                aria-label={`Revoke ${ROLE_LABELS[assignment.local_role]}`}
                                onClick={() => onRevoke(assignment)}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className={styles.muted}>None</span>
                      )}
                    </div>
                  </td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td className={styles.actions}>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={user.principal_id === currentPrincipalId}
                      title={user.principal_id === currentPrincipalId ? "Self-assignment is disabled" : undefined}
                      onClick={() => onAssign(user)}
                    >
                      Assign role
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignmentsTab({
  assignments,
  users,
  loading,
  currentPrincipalId,
  onRevoke,
}: {
  assignments: AssignmentRecord[];
  users: Map<string, AccessUser>;
  loading: boolean;
  currentPrincipalId: string;
  onRevoke: (assignment: AssignmentRecord) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div><h2>Platform assignments</h2><p>Current and historical EvalHub authorization records.</p></div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>User</th><th>Role</th><th>Scope</th><th>Status</th>
              <th>Granted</th><th>Expires</th><th />
            </tr>
          </thead>
          <tbody>
            {loading ? <LoadingRows columns={7} /> : assignments.length === 0 ? (
              <EmptyRow columns={7} message="No platform assignments exist." />
            ) : assignments.map((assignment) => {
              const user = users.get(assignment.principal_id);
              return (
                <tr key={assignment._id}>
                  <td>
                    <strong>{user?.display_name ?? assignment.principal_id}</strong>
                    <small className={styles.block}>{user?.email}</small>
                  </td>
                  <td>{ROLE_LABELS[assignment.local_role]}</td>
                  <td>{assignment.scope.type}: {assignment.scope.id}</td>
                  <td><StatusBadge status={assignment.status} /></td>
                  <td>
                    {formatDate(assignment.created_at)}
                    <small className={styles.block}>
                      by {assignment.granted_by.display_name ?? assignment.granted_by.principal_id}
                    </small>
                  </td>
                  <td>{formatDate(assignment.expires_at)}</td>
                  <td className={styles.actions}>
                    {assignment.status === "active" && assignment.principal_id !== currentPrincipalId && (
                      <button
                        className={styles.dangerButton}
                        type="button"
                        onClick={() => onRevoke(assignment)}
                      >
                        Revoke
                      </button>
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

function AuditTab({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div><h2>Authorization audit</h2><p>Append-only grant and revocation history.</p></div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Action</th><th>Actor</th>
              <th>Target</th><th>Role and scope</th><th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <LoadingRows columns={6} /> : events.length === 0 ? (
              <EmptyRow columns={6} message="No authorization events recorded." />
            ) : events.map((event) => (
              <tr key={event._id}>
                <td>{formatDate(event.occurred_at)}</td>
                <td>{event.event_type.split(".").at(-1)}</td>
                <td>{event.actor.display_name ?? event.actor.principal_id}</td>
                <td>{event.target.display_name ?? event.target.principal_id}</td>
                <td>
                  {ROLE_LABELS[event.local_role]}
                  <small className={styles.block}>
                    {event.scope.type}: {event.scope.id}
                  </small>
                </td>
                <td>{event.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignmentDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AccessUser;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState<PlatformRole>("moderator");
  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [scopeId, setScopeId] = useState("*");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAssignment({
        tenant_id: user.tenant_id,
        principal_id: user.principal_id,
        local_role: role,
        scope: { type: scopeType, id: scopeType === "global" ? "*" : scopeId.trim() },
        reason: reason.trim(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      await onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="assign-title">
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>Platform authorization</p>
            <h2 id="assign-title">Assign role to {user.display_name}</h2>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className={styles.form}>
          <label>Platform role<select value={role} onChange={(event) => setRole(event.target.value as PlatformRole)}>
            {(Object.keys(ROLE_LABELS) as PlatformRole[]).map((value) => (
              <option key={value} value={value}>{ROLE_LABELS[value]}</option>
            ))}
          </select><small>{ROLE_DESCRIPTIONS[role]}</small></label>
          <div className={styles.formGrid}>
            <label>
              Scope type
              <select
                value={scopeType}
                onChange={(event) => {
                  const value = event.target.value as ScopeType;
                  setScopeType(value);
                  if (value === "global") setScopeId("*");
                }}
              >
                <option value="global">Global</option>
                <option value="environment">Environment</option>
                <option value="repository">Repository</option>
                <option value="skill">Skill</option>
              </select>
            </label>
            <label>
              Scope identifier
              <input
                value={scopeId}
                disabled={scopeType === "global"}
                required
                onChange={(event) => setScopeId(event.target.value)}
                placeholder="develop or org/repository"
              />
            </label>
          </div>
          <label>
            Expiration (optional)
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <label>
            Business reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why does this person need this access?"
            />
          </label>
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={saving || reason.trim().length < 5}
            >
              {saving ? "Assigning…" : "Assign role"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RevokeDialog({
  assignment,
  onClose,
  onRevoked,
}: {
  assignment: AssignmentRecord;
  onClose: () => void;
  onRevoked: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try { await revokeAssignment(assignment._id, reason.trim()); await onRevoked(); }
    catch (revokeError) { setError(errorMessage(revokeError)); }
    finally { setSaving(false); }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="revoke-title">
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>Confirm revocation</p>
            <h2 id="revoke-title">Revoke {ROLE_LABELS[assignment.local_role]}?</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className={styles.form}>
          <p>This takes effect on the next authorization check and remains in the audit history.</p>
          <label>
            Revocation reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.dangerButton}
              disabled={saving || reason.trim().length < 5}
            >
              {saving ? "Revoking…" : "Revoke access"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: AssignmentRecord["status"] }) {
  return <span className={`${styles.status} ${styles[status]}`}>{status}</span>;
}

function LoadingRows({ columns }: { columns: number }) {
  return <>{[0, 1, 2].map((value) => (
    <tr key={value}>
      <td colSpan={columns}><span className={styles.skeleton} /></td>
    </tr>
  ))}</>;
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return <tr><td className={styles.empty} colSpan={columns}>{message}</td></tr>;
}
