import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

/** Duplicate a template (same content, new name). */
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

    const baseName = template.name.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, "").trim() || template.name;
    const siblings = await prisma.shmTenantAgreementTemplate.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        name: { startsWith: baseName },
      },
      select: { name: true },
    });
    const names = new Set(siblings.map((s) => s.name));
    let copyName = `${baseName} (copy)`;
    let n = 2;
    while (names.has(copyName)) {
      copyName = `${baseName} (copy ${n})`;
      n += 1;
    }

    const created = await prisma.shmTenantAgreementTemplate.create({
      data: {
        companyId: company.id,
        createdById: user.id,
        name: copyName,
        description: template.description,
        agreementData: template.agreementData,
      },
    });

    return NextResponse.json({
      ok: true,
      template: {
        id: created.id,
        name: created.name,
        description: created.description,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (error) {
    console.error("[shm-templates/duplicate]", error);
    return NextResponse.json(templateApiError(error, "Could not duplicate template."), { status: 500 });
  }
}
