import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { createTenantAgreementFromTemplate, sendCreatedAgreementToTenant } from "../../../../../lib/shm/create-from-template";
import { parseTemplateAgreementData } from "../../../../../lib/shm/ta-templates";
import { isImportedTenantAgreementTemplate } from "../../../../../lib/shm/ta-imported-document";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";

/** Create a new Tenant Agreement from a saved template and open the creator signing form. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
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

    const body = await request.json().catch(() => ({}));
    const tenantName = String(body.tenant_name || body.recipientName || "").trim();
    const tenantEmail = String(body.tenant_email || body.recipientEmail || "").trim().toLowerCase();
    const premisesAddress = String(body.premises_address || body.propertyAddress || "").trim();

    if (!tenantName || !tenantEmail) {
      return NextResponse.json({ ok: false, message: "Tenant name and email are required." }, { status: 400 });
    }

    const agreementData = parseTemplateAgreementData(template.agreementData);
    const imported = isImportedTenantAgreementTemplate(agreementData);
    const adminSignature = String(body.admin_signature || body.signature || "").trim();

    const created = await createTenantAgreementFromTemplate({
      companyId: company.id,
      user: { id: user.id, name: user.name, email: user.email },
      template,
      recipient: {
        tenant_name: tenantName,
        tenant_email: tenantEmail,
        premises_address: premisesAddress || undefined,
      },
      request,
    });

    if (imported) {
      const sent = await sendCreatedAgreementToTenant({
        documentId: created.documentId,
        creatorToken: created.creatorToken,
        tenantName: created.tenantName,
        tenantEmail: created.tenantEmail,
        propertyAddress: created.propertyAddress,
        agreementData: created.agreementData,
        adminSignature: adminSignature || undefined,
        adminName: user.name || "Admin",
        adminEmail: user.email,
        request,
      });

      return NextResponse.json({
        ok: true,
        documentId: created.documentId,
        sent: true,
        signingUrl: sent.signingUrl,
        emailOk: Boolean(sent.emailResult.ok),
        message: sent.emailResult.ok
          ? "Agreement sent to tenant."
          : sent.emailResult.message || "Agreement created but email may not have sent.",
        redirectTo: "/dashboard",
      });
    }

    return NextResponse.json({
      ok: true,
      documentId: created.documentId,
      creatorSigningUrl: created.creatorSigningUrl,
      redirectTo: created.creatorSigningUrl,
    });
  } catch (error) {
    console.error("[shm-templates/use]", error);
    return NextResponse.json(templateApiError(error, "Could not create agreement from template."), { status: 500 });
  }
}
