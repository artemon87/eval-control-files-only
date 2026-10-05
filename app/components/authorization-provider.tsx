"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSession } from "next-auth/react";

import { getMyAuthorization } from "../lib/access-admin-api";
import type {
  AuthorizationContext as AuthorizationState,
  Permission,
} from "../lib/access-admin-types";


interface AuthorizationContextValue {
  authorization: AuthorizationState | null;
  loading: boolean;
  can: (permission: Permission) => boolean;
}

const AuthorizationContext = createContext<AuthorizationContextValue>({
  authorization: null,
  loading: true,
  can: () => false,
});

export function AuthorizationProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const sessionKey =
    status === "authenticated"
      ? session?.user?.email ?? "authenticated"
      : null;
  const [resolved, setResolved] = useState<{
    sessionKey: string;
    authorization: AuthorizationState | null;
  } | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !sessionKey) return;

    const controller = new AbortController();
    void getMyAuthorization(controller.signal)
      .then((authorization) => {
        if (!controller.signal.aborted) {
          setResolved({ sessionKey, authorization });
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setResolved({ sessionKey, authorization: null });
        }
      });
    return () => controller.abort();
  }, [sessionKey, status]);

  const authorization =
    sessionKey && resolved?.sessionKey === sessionKey
      ? resolved.authorization
      : null;
  const loading =
    status === "loading" ||
    (status === "authenticated" && resolved?.sessionKey !== sessionKey);

  const value = useMemo<AuthorizationContextValue>(() => {
    const permissionSet = new Set(authorization?.permissions ?? []);
    return {
      authorization,
      loading,
      can: (permission) => permissionSet.has(permission),
    };
  }, [authorization, loading]);

  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  );
}

export function useAuthorization(): AuthorizationContextValue {
  return useContext(AuthorizationContext);
}
