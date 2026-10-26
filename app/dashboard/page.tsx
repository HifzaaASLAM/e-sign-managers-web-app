import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { getWorkspaceByEmail } from "../../lib/workspace";
import {
  DASHBOARD_DOCUMENT_LIST_LIMIT,
  dashboardDocumentListSelect,
} from "../../lib/dashboard/dashboard-doc-query";
import { activityTotals, buildActivitySeries, serializeDashboardDocs } from "../../lib/dashboard/serialize-docs";
import { DashboardContracts } from "../../components/dashboard/DashboardContracts";
import { DashboardHeader } from "../../components/dashboard/DashboardHeader";
import {
  listPmaDocsAwaitingCreatorAutoSign,
  triggerDuePmaAutoCreatorSignsInBackground,
} from "../../lib/shm/pma-auto-creator-sign-tick";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { email?: string; to?: string; reason?: string; doc?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) redirect("/register");

  // Omit agreementData on the list — it can hold multi‑MB JSON/base64 per tenant agreement.
  const docs = await prisma.shmDocument.findMany({
    where: { companyId: company.id },
    select: dashboardDocumentListSelect,
    orderBy: { createdAt: "desc" },
    take: DASHBOARD_DOCUMENT_LIST_LIMIT,
  });

  const pmaAwaitingCreator = listPmaDocsAwaitingCreatorAutoSign(docs);
  if (pmaAwaitingCreator.length > 0) {
    triggerDuePmaAutoCreatorSignsInBackground(pmaAwaitingCreator.map((d) => d.documentId));
  }

  const serialized = serializeDashboardDocs(docs);
  const activitySeries = buildActivitySeries(serialized);
  const totals = activityTotals(activitySeries);
  const emailStatus = searchParams.email;
  const emailTo = searchParams.to;
  const emailReason = searchParams.reason;
  const emailDoc = searchParams.doc;

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard" />

      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {emailStatus === "sent" && (
          <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Signing email sent to <strong>{emailTo || "recipient"}</strong>.
          </div>
        )}
        {emailStatus === "skipped" && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Document created</strong> but email was not sent. {emailReason || "Configure RESEND_API_KEY and EMAIL_FROM in your environment."}
            {emailDoc ? <> Document <strong>{emailDoc}</strong> — share the signing link manually from the dashboard.</> : null}
          </div>
        )}
        {emailStatus === "error" && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <strong>Document created</strong> but email failed: {emailReason || "Unknown error."}
            {emailDoc ? <> Check Resend logs for <strong>{emailDoc}</strong>.</> : null}
          </div>
        )}
        {serialized.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
            <h1 className="text-xl font-semibold text-slate-900">No documents yet</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Create your first SHM document. Recipients receive a signing email and both parties can be tracked from this dashboard.
            </p>
            <Link
              href="/dashboard/documents/new"
              className="mt-6 inline-flex rounded-md bg-[#1677ff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]"
            >
              New document
            </Link>
          </div>
        ) : (
          <DashboardContracts docs={serialized} activitySeries={activitySeries} activityTotals={totals} />
        )}
      </section>
    </main>
  );
}
