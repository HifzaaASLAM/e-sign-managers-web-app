import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { parseTemplateAgreementData, sanitizeTemplatePayload } from "../../../../lib/shm/ta-templates";
import { mergeTemplateAgreementDataOnSave } from "../../../../lib/shm/ta-template-editor";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

async function requireWorkspace() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 }) };
  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) return { error: NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 403 }) };
  return { user, company };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;
    await ensureTenantAgreementTemplateTable();

    const template = await prisma.shmTenantAgreementTemplate.findFirst({
      where: { id: params.id, companyId: ws.company.id, isActive: true },
    });
    if (!template) return NextResponse.json({ ok: false, message: "Template not found." }, { status: 404 });

    return NextResponse.json({
      ok: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        agreementData: parseTemplateAgreementData(template.agreementData),
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      },
    });
  } catch (error) {
    console.error("[shm-templates GET id]", error);
    return NextResponse.json(templateApiError(error, "Could not load template."), { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;
    await ensureTenantAgreementTemplateTable();

    const existing = await prisma.shmTenantAgreementTemplate.findFirst({
      where: { id: params.id, companyId: ws.company.id, isActive: true },
    });
    if (!existing) return NextResponse.json({ ok: false, message: "Template not found." }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const name = body.name != null ? String(body.name).trim() : existing.name;
    const description = body.description !== undefined
      ? (String(body.description || "").trim() || null)
      : existing.description;
    if (!name) {
      return NextResponse.json({ ok: false, message: "Template name is required." }, { status: 400 });
    }

    const existingAgreementData = parseTemplateAgreementData(existing.agreementData);
    const agreementData = body.agreementData !== undefined
      ? mergeTemplateAgreementDataOnSave(
          existingAgreementData,
          sanitizeTemplatePayload(body.agreementData),
        )
      : existingAgreementData;

    const updated = await prisma.shmTenantAgreementTemplate.update({
      where: { id: existing.id },
      data: {
        name,
        description,
        agreementData: JSON.stringify(agreementData),
      },
    });

    return NextResponse.json({ ok: true, template: { id: updated.id, name: updated.name } });
  } catch (error) {
    console.error("[shm-templates PUT]", error);
    return NextResponse.json(templateApiError(error, "Could not save template."), { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;
    await ensureTenantAgreementTemplateTable();

    const existing = await prisma.shmTenantAgreementTemplate.findFirst({
      where: { id: params.id, companyId: ws.company.id, isActive: true },
    });
    if (!existing) return NextResponse.json({ ok: false, message: "Template not found." }, { status: 404 });

    await prisma.shmTenantAgreementTemplate.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[shm-templates DELETE]", error);
    return NextResponse.json(templateApiError(error, "Could not delete template."), { status: 500 });
  }
}
