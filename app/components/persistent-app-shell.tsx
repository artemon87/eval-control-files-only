"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppPageShell } from "./app-page-shell";

const routeDetails: Record<string, { section: string; page: string }> = {
  "/suggestions": { section: "Discover", page: "Suggestions" },
  "/get-access": { section: "Access", page: "Request access" },
  "/admin/access": { section: "Administration", page: "Access management" },
  "/admin/product-updates": {
    section: "Administration",
    page: "Product updates",
  },
};

export function PersistentAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const details = routeDetails[pathname];

  if (!details) return children;

  const action =
    pathname === "/admin/product-updates" ? (
      <Link href="/whats-new">View public page →</Link>
    ) : undefined;

  return (
    <AppPageShell
      activePath={pathname}
      section={details.section}
      page={details.page}
      action={action}
    >
      {children}
    </AppPageShell>
  );
}
