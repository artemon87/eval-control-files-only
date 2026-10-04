import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { GetAccessClient } from "./get-access-client";


export default async function GetAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  return <GetAccessClient />;
}
