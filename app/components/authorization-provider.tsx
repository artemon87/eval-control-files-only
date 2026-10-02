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
  const { status } = useSession();
  const [authorization, setAuthorization] = useState<AuthorizationState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      setAuthorization(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void getMyAuthorization(controller.signal)
      .then(setAuthorization)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuthorization(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [status]);

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
