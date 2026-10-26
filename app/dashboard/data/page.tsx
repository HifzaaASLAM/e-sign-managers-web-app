import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DASHBOARD_DOCUMENT_LIST_LIMIT } from "../../../lib/dashboard/dashboard-doc-query";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";

export const dynamic = "force-dynamic";

export default async function DocumentDataPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[dashboard/data] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <DashboardHeader active="/dashboard/data" />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load workspace data. Please refresh, or check the database connection.
          </div>
        </section>
      </main>
    );
  }
  if (!companyId) redirect("/register");

  let docs: Array<{
    id: string;
    documentId: string;
    documentType: string;
    propertyAddress: string | null;
    status: string;
    recipientName: string | null;
    recipientEmail: string | null;
    recipientRole: string | null;
    createdAt: Date;
    sentAt: Date | null;
    viewedAt: Date | null;
    signedAt: Date | null;
    signers: Array<{
      name: string | null;
      email: string | null;
      role: string | null;
      signerType: string;
      status: string;
    }>;
  }> = [];
  let loadError: string | null = null;

  try {
    docs = await prisma.shmDocument.findMany({
      where: { companyId },
      select: {
        id: true,
        documentId: true,
        documentType: true,
        propertyAddress: true,
        status: true,
        recipientName: true,
        recipientEmail: true,
        recipientRole: true,
        createdAt: true,
        sentAt: true,
        viewedAt: true,
        signedAt: true,
        signers: {
          orderBy: { signerType: "asc" },
          select: {
            name: true,
            email: true,
            role: true,
            signerType: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: DASHBOARD_DOCUMENT_LIST_LIMIT,
    });
  } catch (error) {
    console.error("[dashboard/data] documents query failed", error);
    loadError = "Could not load document data. Tables may be missing or the database is unavailable.";
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/data" />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-black tracking-tight text-slate-950">All Data</h1>
          <Link href="/dashboard/documents/new" className="inline-flex rounded-md bg-[#1677ff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]">
            New document
          </Link>
        </div>

        {loadError ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Documents</th>
                  <th className="px-5 py-3">Signer</th>
                  <th className="px-5 py-3">Property Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((doc) => {
                  const recipient = doc.signers.find((signer) => signer.signerType === "recipient");
                  const signerName = recipient?.name || doc.recipientName || "—";
                  const signerEmail = recipient?.email || doc.recipientEmail || "—";
                  const signerRole = recipient?.role || doc.recipientRole || "Signer";

                  return (
                    <tr key={doc.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-950">{doc.documentType}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-400">{doc.documentId}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">{signerName}</p>
                        <p className="mt-1 text-xs text-slate-500">{signerEmail}</p>
                        <p className="mt-1 text-xs text-slate-400">{signerRole}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="max-w-[420px] text-slate-700">{doc.propertyAddress || "—"}</p>
                      </td>
                    </tr>
                  );
                })}
                {docs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-12 text-center text-sm text-slate-500">
                      {loadError ? "Document data is temporarily unavailable." : "No document data found yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
