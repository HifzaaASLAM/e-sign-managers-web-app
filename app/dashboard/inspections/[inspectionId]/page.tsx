import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { DashboardHeader } from "../../../../components/dashboard/DashboardHeader";
import { InspectionDetailClient } from "../../../../components/dashboard/InspectionDetailClient";
import { requireCompanyInspection } from "../../../../lib/inspection/auth";
import { serializeInspection } from "../../../../lib/inspection/service";
import { ensureInspectionSchema } from "../../../../lib/inspection/ensure-schema";

export const dynamic = "force-dynamic";

export default async function InspectionDetailPage({
  params,
}: {
  params: { inspectionId: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch {
    redirect("/login");
  }
  if (!companyId) redirect("/register");

  try {
    await ensureInspectionSchema();
  } catch {
    // continue; detail will 404 if tables missing
  }

  const inspection = await requireCompanyInspection(params.inspectionId, companyId);
  if (!inspection) notFound();

  const serialized = serializeInspection(inspection, { includeTokens: true });

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-950">
      <DashboardHeader active="/dashboard/inspections" />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <InspectionDetailClient initial={serialized} />
      </section>
    </main>
  );
}
