import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { ProductUpdatesAdmin } from "./product-updates-admin";


export default async function ProductUpdatesAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  return <ProductUpdatesAdmin />;
}
