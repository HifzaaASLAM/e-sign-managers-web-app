import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { parseTemplateAgreementData } from "../../../../../lib/shm/ta-templates";
import { generateTenantAgreementDocxBase64 } from "../../../../../lib/shm/tenant-agreement-export";
import {
  getImportedDocumentBuffer,
  importedDocumentFileName,
  importedDocumentFormat,
  isImportedTenantAgreementTemplate,
} from "../../../../../lib/shm/ta-imported-document";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

function safeFileName(name: string) {
  return String(name || "template")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "template";
}

/** Export template content as a filled Tenant Agreement document (Word/.docx — same format as signing flow). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 });
    }

    const { user, company } = await getWorkspaceByEmail(session.user.email);
    if (!user || !company) {
      return NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 403 });
    }

    await ensureTenantAgreementTemplateTable();

    const template = await prisma.shmTenantAgreementTemplate.findFirst({
      where: { id: params.id, companyId: company.id, isActive: true },
    });
    if (!template) {
      return NextResponse.json({ ok: false, message: "Template not found." }, { status: 404 });
    }

    const agreementData = parseTemplateAgreementData(template.agreementData);
    if (isImportedTenantAgreementTemplate(agreementData)) {
      const imported = getImportedDocumentBuffer(agreementData);
      if (!imported) {
        return NextResponse.json({ ok: false, message: "Imported document is missing from this template." }, { status: 400 });
      }
      const format = importedDocumentFormat(agreementData) || imported.format;
      const fileName = importedDocumentFileName(agreementData, safeFileName(template.name));
      return NextResponse.json({
        ok: true,
        fileName,
        fileContent: imported.buffer.toString("base64"),
        fileType: imported.mimeType,
        isDocx: format === "docx",
        isPdf: format === "pdf",
        message: format === "pdf" ? "Exported imported PDF document." : "Exported imported Word document.",
      });
    }

    if (!agreementData.provider_name && user.name) agreementData.provider_name = user.name;
    if (!agreementData.provider_email) agreementData.provider_email = user.email;
    if (!agreementData.tenant_name) agreementData.tenant_name = "[Tenant name]";
    if (!agreementData.tenant_email) agreementData.tenant_email = "[Tenant email]";

    const generated = await generateTenantAgreementDocxBase64(agreementData, {
      documentId: `TEMPLATE-${template.id.slice(0, 8).toUpperCase()}`,
      signedAt: new Date(),
    });

    const fileName = `${safeFileName(template.name)}-export.docx`;

    return NextResponse.json({
      ok: true,
      fileName,
      fileContent: generated.base64,
      fileType: generated.mimeType,
      isDocx: true,
      message: "Exported as Word (.docx) — same format used for Tenant Agreements.",
    });
  } catch (error) {
    console.error("[shm-templates/export]", error);
    return NextResponse.json(templateApiError(error, "Could not export template."), { status: 500 });
  }
}
