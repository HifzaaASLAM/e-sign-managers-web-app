import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";
import { getApplyUrl } from "../../../lib/applications/service";
import { ApplicationsClient } from "../../../components/dashboard/ApplicationsClient";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[applications] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <DashboardHeader active="/dashboard/applications" />
        <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load workspace. Please refresh, or check the database connection.
          </div>
        </section>
      </main>
    );
  }
  if (!companyId) redirect("/register");

  let serialized: Array<{
    id: string;
    propertyAddress: string;
    title: string | null;
    decisionStatus: string;
    readinessScore: number;
    applyUrl: string | null;
    documentCount: number;
    primaryDocumentId: string | null;
    createdAt: string;
  }> = [];
  let loadError: string | null = null;

  try {
    const applications = await prisma.rentalApplication.findMany({
      where: { companyId },
      include: {
        documents: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    serialized = applications.map((app) => ({
      id: app.id,
      propertyAddress: app.propertyAddress,
      title: app.title,
      decisionStatus: app.decisionStatus,
      readinessScore: app.readinessScore,
      applyUrl: app.inviteToken ? getApplyUrl(app.inviteToken) : null,
      documentCount: app.documents.length,
      primaryDocumentId: app.documents.find((d) => d.isPrimary)?.documentId || app.documents[0]?.documentId || null,
      createdAt: app.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("[applications] lookup failed", error);
    loadError =
      "Rental application tables are not available yet. Documents still work from the main dashboard.";
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/applications" />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">Rental applications</h1>
            <p className="mt-1 text-sm text-slate-500">
              Campaign view with decisions, readiness scores, and invite-to-apply links.
            </p>
          </div>
          <Link
            href="/dashboard/documents/new"
            className="rounded-md bg-[#1677ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1466e6]"
          >
            Send Tenant Application
          </Link>
        </div>
        {loadError ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}
        <ApplicationsClient applications={serialized} />
      </section>
    </main>
  );
}
