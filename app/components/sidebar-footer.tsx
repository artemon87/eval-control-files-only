"use client";

import { useEffect, useMemo, useState } from "react";

import { configuredEvalApi } from "../lib/eval-api";

export type SidebarDataState =
  | "connecting"
  | "live"
  | "error"
  | "unconfigured";

type SessionUser = {
  name?: string | null;
  email?: string | null;
};

type SessionResponse = {
  user?: SessionUser | null;
};

function initials(user: SessionUser | null) {
  const source = user?.name?.trim() || user?.email?.trim() || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function useDetectedDataState(enabled: boolean) {
  const [state, setState] = useState<SidebarDataState>("connecting");

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();

    void Promise.resolve().then(async () => {
      const api = configuredEvalApi();
      if (!api) {
        if (active) setState("unconfigured");
        return;
      }

      try {
        await api.listRunBatch(undefined, 1, controller.signal);
        if (active) setState("live");
      } catch {
        if (active && !controller.signal.aborted) setState("error");
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled]);

  return state;
}

export function SidebarFooter({
  dataState: suppliedDataState,
}: {
  dataState?: SidebarDataState;
}) {
  const detectedDataState = useDetectedDataState(!suppliedDataState);
  const dataState = suppliedDataState ?? detectedDataState;
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as SessionResponse;
      })
      .then((nextSession) => {
        if (!controller.signal.aborted) {
          setSession(nextSession);
          setSessionResolved(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSessionResolved(true);
      });

    return () => controller.abort();
  }, []);

  const user = session?.user ?? null;
  const userInitials = useMemo(() => initials(user), [user]);

  async function signOut() {
    setSigningOut(true);
    try {
      const csrfResponse = await fetch("/api/auth/csrf", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const csrf = (await csrfResponse.json()) as { csrfToken?: string };
      if (!csrf.csrfToken) throw new Error("Missing sign-out token");

      const response = await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          csrfToken: csrf.csrfToken,
          callbackUrl: "/",
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { url?: string }
        | null;
      window.location.assign(result?.url || "/");
    } catch {
      window.location.assign("/api/auth/signout");
    }
  }

  return (
    <div className="sidebar-footer">
      <div className={`sidebar-note sidebar-note--${dataState}`}>
        <span>Data status</span>
        <strong>
          <i />{" "}
          {dataState === "live"
            ? "Live API connected"
            : dataState === "connecting"
              ? "Connecting to API"
              : dataState === "error"
                ? "API unavailable"
                : "API not configured"}
        </strong>
        <small>FastAPI · MongoDB · read only</small>
      </div>

      <div className="profile">
        <span aria-hidden="true">{userInitials}</span>
        <div>
          <strong>
            {user?.name || user?.email || (sessionResolved ? "Not signed in" : "Loading account…")}
          </strong>
          {user?.email && user.name ? <small title={user.email}>{user.email}</small> : null}
        </div>
        {user ? (
          <button
            className="profile-action"
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        ) : sessionResolved ? (
          <a className="profile-action" href="/api/auth/signin">
            Sign in
          </a>
        ) : null}
      </div>
    </div>
  );
}
