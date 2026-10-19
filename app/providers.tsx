"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

import { AuthorizationProvider } from "./components/authorization-provider";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <AuthorizationProvider>{children}</AuthorizationProvider>
    </SessionProvider>
  );
}
