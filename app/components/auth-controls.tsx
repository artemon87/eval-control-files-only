"use client";

import { useEffect, useMemo, useState } from "react";

type SessionUser = {
  name?: string | null;
  email?: string | null;
};

type SessionResponse = {
  user?: SessionUser | null;
};

let cachedSession: SessionResponse | null | undefined;
let sessionRequest: Promise<SessionResponse | null> | null = null;

function loadSession() {
  if (cachedSession !== undefined) return Promise.resolve(cachedSession);
  if (sessionRequest) return sessionRequest;

  sessionRequest = fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as SessionResponse;
    })
    .catch(() => null)
    .then((session) => {
      cachedSession = session;
      return session;
    })
    .finally(() => {
      sessionRequest = null;
    });

  return sessionRequest;
}

function initials(user: SessionUser | null) {
  const source = user?.name?.trim() || user?.email?.trim() || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AuthControls() {
  const [session, setSession] = useState<SessionResponse | null | undefined>(
    cachedSession,
  );
  const [signingOut, setSigningOut] = useState(false);
  const user = session?.user ?? null;
  const userInitials = useMemo(() => initials(user), [user]);

  useEffect(() => {
    let active = true;

    void loadSession().then((nextSession) => {
      if (active) setSession(nextSession);
    });

    return () => {
      active = false;
    };
  }, []);

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
      cachedSession = null;
      window.location.assign(result?.url || "/");
    } catch {
      window.location.assign("/api/auth/signout");
    }
  }

  return (
    <div className="profile">
      <span aria-hidden="true">{userInitials}</span>
      <div>
        <strong>
          {user?.name ||
            user?.email ||
            (session === undefined ? "Loading account…" : "Not signed in")}
        </strong>
        {user?.email && user.name ? (
          <small title={user.email}>{user.email}</small>
        ) : null}
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
      ) : session === null ? (
        <a className="profile-action" href="/api/auth/signin">
          Sign in
        </a>
      ) : null}
    </div>
  );
}
