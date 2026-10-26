import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import {
  buildImportedTemplateAgreementData,
  detectImportFormat,
  isAcceptedImportMime,
  MAX_IMPORTED_DOCX_BYTES,
} from "../../../../lib/shm/ta-imported-document";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

async function requireWorkspace() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 }) };
  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) return { error: NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 403 }) };
  return { user, company };
}

/** Import a PDF or Word document as a Tenant Agreement template (landlord + premises stored in agreement data). */
export async function POST(request: Request) {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;

    await ensureTenantAgreementTemplateTable();

    const form = await request.formData();
    const landlordName = String(form.get("landlord_name") || form.get("landlordName") || "").trim();
    const propertyAddress = String(form.get("property_address") || form.get("propertyAddress") || "").trim();
    const file = form.get("document") ?? form.get("file");

    if (!landlordName) {
      return NextResponse.json({ ok: false, message: "Landlord name is required." }, { status: 400 });
    }
    if (!propertyAddress) {
      return NextResponse.json({ ok: false, message: "Property address is required." }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Upload a PDF or Word document (.pdf or .docx)." }, { status: 400 });
    }

    const fileName = String(file.name || "document.docx").trim();
    if (!isAcceptedImportMime(file.type || "", fileName)) {
      return NextResponse.json({ ok: false, message: "Only PDF (.pdf) and Word (.docx) files are supported for import." }, { status: 400 });
    }

    const format = detectImportFormat(file.type || "", fileName);
    if (!format) {
      return NextResponse.json({ ok: false, message: "Could not determine file type. Use a .pdf or .docx file." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length) {
      return NextResponse.json({ ok: false, message: "The uploaded file is empty." }, { status: 400 });
    }
    if (bytes.length > MAX_IMPORTED_DOCX_BYTES) {
      return NextResponse.json({
        ok: false,
        message: `File is too large (max ${Math.round(MAX_IMPORTED_DOCX_BYTES / (1024 * 1024))} MB).`,
      }, { status: 400 });
    }

    const agreementData = buildImportedTemplateAgreementData({
      landlordName,
      propertyAddress,
      fileBase64: bytes.toString("base64"),
      originalFileName: fileName,
      format,
    });

    if (!agreementData.provider_email && ws.user.email) {
      agreementData.provider_email = ws.user.email;
    }

    const created = await prisma.shmTenantAgreementTemplate.create({
      data: {
        companyId: ws.company.id,
        createdById: ws.user.id,
        name: landlordName,
        description: `Imported document · ${propertyAddress}`,
        agreementData: JSON.stringify(agreementData),
      },
    });

    return NextResponse.json({
      ok: true,
      template: {
        id: created.id,
        name: created.name,
        description: created.description,
        importedDocument: true,
        premisesAddress: propertyAddress,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[shm-templates/import]", error);
    return NextResponse.json(templateApiError(error, "Could not import document."), { status: 500 });
  }
}
