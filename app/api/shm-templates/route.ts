import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { sanitizeTemplatePayload } from "../../../lib/shm/ta-templates";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

async function requireWorkspace() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 }) };
  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) return { error: NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 403 }) };
  return { user, company };
}

export async function GET() {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;

    await ensureTenantAgreementTemplateTable();

    const templates = await prisma.shmTenantAgreementTemplate.findMany({
      where: { companyId: ws.company.id, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, templates });
  } catch (error) {
    console.error("[shm-templates GET]", error);
    return NextResponse.json(templateApiError(error, "Could not load templates."), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ws = await requireWorkspace();
    if ("error" in ws) return ws.error;

    await ensureTenantAgreementTemplateTable();

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim() || null;
    if (!name) {
      return NextResponse.json({ ok: false, message: "Template name is required." }, { status: 400 });
    }

    const agreementData = sanitizeTemplatePayload(body.agreementData);
    const created = await prisma.shmTenantAgreementTemplate.create({
      data: {
        companyId: ws.company.id,
        createdById: ws.user.id,
        name,
        description,
        agreementData: JSON.stringify(agreementData),
      },
    });

    return NextResponse.json({ ok: true, template: { id: created.id, name: created.name } });
  } catch (error) {
    console.error("[shm-templates POST]", error);
    return NextResponse.json(templateApiError(error, "Could not create template."), { status: 500 });
  }
}
