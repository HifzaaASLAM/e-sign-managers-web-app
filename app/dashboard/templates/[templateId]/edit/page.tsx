import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { getAppUrl } from "../../../../../lib/shm/documents";
import { parseTemplateAgreementData } from "../../../../../lib/shm/ta-templates";
import { prepareAgreementDataForTemplateEditor } from "../../../../../lib/shm/ta-template-editor";
import { DashboardHeader } from "../../../../../components/dashboard/DashboardHeader";
import { DashboardNav } from "../../../../../components/dashboard/DashboardNav";
import { TemplateEditIframe } from "../../../../../components/dashboard/TemplateEditIframe";

export const dynamic = "force-dynamic";

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export default async function EditTemplatePage({ params }: { params: { templateId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let user: { name: string | null; email: string } | null = null;
  let companyId: string | null = null;

  try {
    const workspace = await getWorkspaceByEmail(session.user.email);
    user = workspace.user;
    companyId = workspace.company?.id ?? null;
  } catch (error) {
    console.error("[dashboard/templates/edit] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-[#f4f5f7] text-slate-950">
        <DashboardHeader active="/dashboard/templates" />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load workspace. Please refresh, or check the database connection.
          </div>
          <Link href="/dashboard/templates" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to templates
          </Link>
        </section>
      </main>
    );
  }
  if (!user || !companyId) redirect("/register");

  let template: Awaited<ReturnType<typeof prisma.shmTenantAgreementTemplate.findFirst>> = null;
  try {
    template = await prisma.shmTenantAgreementTemplate.findFirst({
      where: { id: params.templateId, companyId, isActive: true },
    });
  } catch (error) {
    console.error("[dashboard/templates/edit] template lookup failed", error);
    return (
      <main className="min-h-screen bg-[#f4f5f7] text-slate-950">
        <DashboardHeader active="/dashboard/templates" />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Template tables are not available yet on this database.
          </div>
          <Link href="/dashboard/templates" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to templates
          </Link>
        </section>
      </main>
    );
  }
  if (!template) notFound();

  const agreementData = prepareAgreementDataForTemplateEditor(
    parseTemplateAgreementData(template.agreementData),
    { adminEmail: user.email },
  );

  let templateHtml = "";
  try {
    templateHtml = await fs.readFile(
      path.join(process.cwd(), "lib", "shm", "templates", "tenant-agreement.html"),
      "utf8",
    );
  } catch (error) {
    console.error("[dashboard/templates/edit] template html read failed", error);
    return (
      <main className="min-h-screen bg-[#f4f5f7] text-slate-950">
        <DashboardHeader active="/dashboard/templates" />
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load the template editor file.
          </div>
          <Link href="/dashboard/templates" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to templates
          </Link>
        </section>
      </main>
    );
  }
  const appUrl = getAppUrl();

  const iframeScript = `
    window.SHM_TEMPLATE_MODE = true;
    window.SHM_TEMPLATE_ID = ${safeScriptJson(template.id)};
    window.SHM_TEMPLATE_NAME = ${safeScriptJson(template.name)};
    window.SHM_DOC_ID = '';
    window.SHM_TOKEN = '';
    window.SHM_API_URL = '/shm-docs/';
    window.SHM_SIGNER_ROLE = 'creator';
    window.SHM_SIGNER_TYPE = 'creator';
    window.SHM_DOCUMENT_CONTEXT = ${safeScriptJson({
      documentType: "Tenant Agreement",
      documentId: "",
      status: "Template",
      propertyAddress: agreementData.premises_address || "",
      recipientName: "",
      recipientEmail: "",
      recipientRole: "Tenant",
      adminName: user.name || "Admin",
      adminEmail: user.email,
      tenantName: "",
      tenantEmail: "",
      agreementData,
      templateMode: true,
      templateId: template.id,
      templateName: template.name,
    })};
    window.SHM_DASHBOARD_URL = '/dashboard/templates';
    document.addEventListener('DOMContentLoaded', function(){
      if (typeof switchTaSigTab === 'function') {
        var btn = document.querySelector('.sig-tab[onclick*=\"draw\"]');
        if (btn) switchTaSigTab('draw', btn);
      }
    });
  `;

  const srcDoc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${appUrl}/" />
  <link rel="stylesheet" href="/shm-plugin-assets/signing.css" />
  <style>html,body{margin:0;min-height:100%;background:#f4f5f7;} body{padding:0;}</style>
  <script>${iframeScript}</script>
</head>
<body id="shm-signing-wrapper">
  ${templateHtml}
</body>
</html>`;

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-slate-900">
              SHM Documents
            </Link>
            <span className="hidden truncate text-sm text-slate-400 sm:inline">Editing template: {template.name}</span>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <DashboardNav active="/dashboard/templates" />
          </div>
        </div>
      </header>
      <TemplateEditIframe title={`Edit template ${template.name}`} srcDoc={srcDoc} />
    </main>
  );
}
