import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { DashboardHeader } from "../../../components/dashboard/DashboardHeader";
import { TemplatesClient } from "../../../components/dashboard/TemplatesClient";
import { parseTemplateAgreementData } from "../../../lib/shm/ta-templates";
import { templateListShowsAsImportedDocument } from "../../../lib/shm/ta-template-editor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  let loadError: string | null = null;

  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[dashboard/templates] workspace lookup failed", error);
    loadError = "Could not load workspace. Please refresh, or check the database connection.";
  }
  if (!loadError && !companyId) redirect("/register");

  // Table ensure is cached in-process; do not block page paint on repeated DDL.
  if (companyId) {
    void import("../../../lib/shm/ensure-ta-template-table")
      .then((m) => m.ensureTenantAgreementTemplateTable())
      .catch((error) => console.error("[dashboard/templates] ensure table failed", error));
  }

  let templates: Array<{
    id: string;
    name: string;
    description: string | null;
    agreementData: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  if (companyId) {
    try {
      templates = await prisma.shmTenantAgreementTemplate.findMany({
        where: { companyId, isActive: true },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          description: true,
          agreementData: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      console.error("[dashboard/templates] query failed", error);
      loadError =
        loadError ||
        "Template tables are not available yet on this database. Documents still work from the main dashboard.";
    }
  }

  const initialTemplates = templates.map((t) => {
    const agreementData = parseTemplateAgreementData(t.agreementData);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      importedDocument: templateListShowsAsImportedDocument(agreementData, t.description),
      premisesAddress: String(agreementData.premises_address || "").trim() || null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  });

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/templates" />

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {loadError ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        ) : null}
        <TemplatesClient initialTemplates={initialTemplates} />
      </section>
    </main>
  );
}
