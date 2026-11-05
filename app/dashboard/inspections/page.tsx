import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";
import { InspectionsClient } from "../../../components/dashboard/InspectionsClient";
import { getInspectionCaptureUrl, getInspectionReportUrl } from "../../../lib/inspection/urls";
import { ensureInspectionSchema } from "../../../lib/inspection/ensure-schema";

export const dynamic = "force-dynamic";

export default async function InspectionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[inspections] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <DashboardHeader active="/dashboard/inspections" />
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
    type: string;
    status: string;
    tenantName: string;
    propertyName: string;
    scheduledAt: string | null;
    createdAt: string;
    captureUrl: string | null;
    reportUrl: string | null;
  }> = [];
  let loadError: string | null = null;

  try {
    await ensureInspectionSchema();
    const rows = await prisma.inspection.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    serialized = rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      tenantName: row.tenantName,
      propertyName: row.propertyName,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      captureUrl: getInspectionCaptureUrl(row.captureToken),
      reportUrl: row.reportToken ? getInspectionReportUrl(row.reportToken) : null,
    }));
  } catch (error) {
    console.error("[inspections] lookup failed", error);
    loadError =
      "Inspection tables are not available yet. Run prisma db push on the server, then refresh.";
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/inspections" />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">Inspection</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Entry, routine, and exit inspections. Create an entry inspection to collect room photos.
          </p>
        </div>
        {loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        ) : (
          <InspectionsClient inspections={serialized} />
        )}
      </section>
    </main>
  );
}
