import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export const dynamic = "force-dynamic";

/** Root entry: send signed-in users to the dashboard, everyone else to login. */
export default async function HomePage() {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) redirect("/dashboard");
  } catch {
    // Session lookup can fail during cold start; still land on login.
  }
  redirect("/login");
}
