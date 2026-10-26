import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";
import { ProfilesClient } from "../../../components/dashboard/ProfilesClient";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[profiles] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <DashboardHeader active="/dashboard/profiles" />
        <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load workspace. Please refresh, or check the database connection.
          </div>
        </section>
      </main>
    );
  }
  if (!companyId) redirect("/register");

  let profiles: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    updatedAt: string;
  }> = [];
  let loadError: string | null = null;

  try {
    const rows = await prisma.applicantProfile.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    profiles = rows.map((p) => ({
      id: p.id,
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      updatedAt: p.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error("[profiles] lookup failed", error);
    loadError = "Applicant profile tables are not available yet on this database.";
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/profiles" />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold text-slate-950">Applicant profiles</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reusable renter profiles used to prefill Tenant Application forms (fill once, apply many).
        </p>
        {loadError ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}
        <div className="mt-6">
          <ProfilesClient initialProfiles={profiles} />
        </div>
      </section>
    </main>
  );
}
