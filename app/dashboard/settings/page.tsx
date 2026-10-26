import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";
import { WorkspaceMemberInvite } from "../../../components/dashboard/WorkspaceMemberInvite";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let user: { name: string | null; email: string } | null = null;
  let company: { name: string } | null = null;
  let companyUserRole: string | null = null;
  let loadError: string | null = null;

  try {
    const workspace = await getWorkspaceByEmail(session.user.email);
    user = workspace.user;
    company = workspace.company;
    companyUserRole = workspace.companyUser?.role ?? null;
  } catch (error) {
    console.error("[dashboard/settings] workspace lookup failed", error);
    loadError = "Could not load workspace settings. Please refresh, or check the database connection.";
  }

  if (!loadError && (!user || !company)) redirect("/register");

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/settings" />
      <section className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-4xl font-black tracking-tight">Workspace settings</h1>
          {loadError ? (
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {loadError}
            </div>
          ) : (
            <>
              <div className="mt-8 grid gap-4 text-sm">
                <p><span className="font-bold">Workspace:</span> {company?.name}</p>
                <p><span className="font-bold">Signed in as:</span> {user?.name || "—"} · {user?.email}</p>
              </div>
              <WorkspaceMemberInvite
                canInvite={companyUserRole === "OWNER" || companyUserRole === "ADMIN"}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
