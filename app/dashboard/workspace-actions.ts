"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function switchWorkspaceCompany(slug: string) {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return;

  const store = await cookies();
  store.set("shm_workspace", normalized, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
}
