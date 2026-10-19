"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useAuthorization } from "./authorization-provider";

export function AuthControls() {
  const { data: session, status } = useSession();
  const {
    authorization,
    loading: authorizationLoading,
  } = useAuthorization();

  if (status === "loading") {
    return (
      <div className="evalhub-auth">
        <span className="evalhub-auth-avatar">…</span>

        <div className="evalhub-auth-details">
          <strong>Loading</strong>
          <small>Checking session</small>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="evalhub-auth">
        <div className="evalhub-auth-row">
          <span className="evalhub-auth-avatar">V</span>

          <div className="evalhub-auth-details">
            <strong>Viewer</strong>
            <small>Not signed in</small>
          </div>
        </div>

        <button
          type="button"
          className="evalhub-auth-button"
          onClick={() =>
            signIn("microsoft-entra-id", {
              redirectTo: "/",
            })
          }
        >
          Sign in
        </button>
      </div>
    );
  }

  const displayName =
    session.user.name ?? session.user.email ?? "Signed-in user";

  const avatar = displayName.charAt(0).toUpperCase();

  const displayRole = (() => {
    if (authorization?.roles.includes("admin")) {
      return "Admin";
    }

    if (authorization?.roles.includes("editor")) {
      return "Editor";
    }

    return "Viewer";
  })();

  return (
    <div className="evalhub-auth">
      <div className="evalhub-auth-row">
        <span className="evalhub-auth-avatar">{avatar}</span>

        <div className="evalhub-auth-details">
          <strong>{displayName}</strong>

          {session.user.email && <small>{session.user.email}</small>}

          <small className="evalhub-auth-role">
            {authorizationLoading ? "Checking access…" : displayRole}
          </small>
        </div>
      </div>

      <button
        type="button"
        className="evalhub-auth-button evalhub-auth-button-secondary"
        onClick={() =>
          signOut({
            redirectTo: "/",
          })
        }
      >
        Sign out
      </button>
    </div>
  );
}
