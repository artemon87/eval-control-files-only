import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { AccessAdminClient } from "./access-admin-client";


export default async function AccessAdminPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }
  return <AccessAdminClient />;
}
