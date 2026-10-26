import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import {
  createTenantAgreementFromTemplate,
  createMultiTenantAgreementFromTemplate,
  sendCreatedAgreementToTenant,
  sendMultiTenantAgreementToTenants,
  parseRecipientLines,
  bulkToTemplateRecipient,
  type TemplateRecipient,
} from "../../../../../lib/shm/create-from-template";
import { ensureTenantAgreementTemplateTable, templateApiError } from "../../../../../lib/shm/ensure-ta-template-table";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_RECIPIENTS = 40;

/** Create + creator-sign + email Tenant Agreements for many recipients from one template. */
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
    const adminSignature = String(body.admin_signature || body.signature || "").trim();
    const landlordName = String(body.landlord_name || body.landlordName || "").trim();
    const landlordEmail = String(body.landlord_email || body.landlordEmail || "").trim().toLowerCase();
    const landlord =
      landlordName && landlordEmail.includes("@") ? { name: landlordName, email: landlordEmail } : null;

    let recipients: TemplateRecipient[] = [];
    if (Array.isArray(body.recipients)) {
      recipients = body.recipients
        .map((row: Record<string, unknown>) => ({
          tenant_name: String(row.tenant_name || row.name || "").trim(),
          tenant_email: String(row.tenant_email || row.email || "").trim().toLowerCase(),
          premises_address: String(row.premises_address || row.premises || row.address || "").trim() || undefined,
        }))
        .filter((r: TemplateRecipient) => r.tenant_name && r.tenant_email.includes("@"));
    } else if (typeof body.recipients_text === "string") {
      recipients = parseRecipientLines(body.recipients_text).map(bulkToTemplateRecipient);
    }

    if (!recipients.length) {
      return NextResponse.json({
        ok: false,
        message: "Add at least one recipient (Name, Email, optional Premises — one per line).",
      }, { status: 400 });
    }

    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({
        ok: false,
        message: `Bulk send is limited to ${MAX_RECIPIENTS} recipients at a time.`,
      }, { status: 400 });
    }

    // Dedupe by email (keep first)
    const seen = new Set<string>();
    recipients = recipients.filter((r) => {
      if (seen.has(r.tenant_email)) return false;
      seen.add(r.tenant_email);
      return true;
    });

    const adminName = user.name || "Admin";
    const adminEmail = user.email;
    const results: Array<{
      ok: boolean;
      tenant_name: string;
      tenant_email: string;
      documentId?: string;
      signingUrl?: string;
      emailOk?: boolean;
      message?: string;
    }> = [];

    if (recipients.length >= 2) {
      try {
        const created = await createMultiTenantAgreementFromTemplate({
          companyId: company.id,
          user: { id: user.id, name: user.name, email: user.email },
          template,
          recipients,
          landlord,
          request,
        });

        const sent = await sendMultiTenantAgreementToTenants({
          documentId: created.documentId,
          creatorToken: created.creatorToken,
          recipientSigners: created.recipientSigners,
          propertyAddress: created.propertyAddress,
          agreementData: created.agreementData,
          adminSignature,
          adminName,
          adminEmail,
          request,
        });

        for (const row of sent.emailResults) {
          results.push({
            ok: row.emailOk,
            tenant_name: row.tenant_name,
            tenant_email: row.tenant_email,
            documentId: created.documentId,
            signingUrl: row.signingUrl,
            emailOk: row.emailOk,
            message: row.message,
          });
        }
      } catch (error) {
        return NextResponse.json({
          ok: false,
          message: error instanceof Error ? error.message : "Could not send multi-tenant agreement.",
        }, { status: 500 });
      }

      const sentCount = results.filter((r) => r.ok).length;
      const failed = results.length - sentCount;
      return NextResponse.json({
        ok: failed === 0,
        sent: sentCount,
        failed,
        results,
        documentId: results[0]?.documentId,
        message: failed
          ? `Sent ${sentCount} email${sentCount === 1 ? "" : "s"}, failed ${failed}. All tenants share one agreement (${results[0]?.documentId || ""}).`
          : `Sent ${sentCount} signing links for one shared agreement (${results[0]?.documentId || ""}).`,
      });
    }

    for (const recipient of recipients) {
      try {
        const created = await createTenantAgreementFromTemplate({
          companyId: company.id,
          user: { id: user.id, name: user.name, email: user.email },
          template,
          recipient,
          request,
        });

        const sent = await sendCreatedAgreementToTenant({
          documentId: created.documentId,
          creatorToken: created.creatorToken,
          tenantName: created.tenantName,
          tenantEmail: created.tenantEmail,
          propertyAddress: created.propertyAddress,
          agreementData: created.agreementData,
          adminSignature,
          adminName,
          adminEmail,
          request,
        });

        results.push({
          ok: true,
          tenant_name: created.tenantName,
          tenant_email: created.tenantEmail,
          documentId: created.documentId,
          signingUrl: sent.signingUrl,
          emailOk: Boolean(sent.emailResult.ok),
          message: sent.emailResult.ok
            ? "Sent"
            : sent.emailResult.message || "Created but email may not have sent",
        });
      } catch (error) {
        results.push({
          ok: false,
          tenant_name: recipient.tenant_name,
          tenant_email: recipient.tenant_email,
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;

    return NextResponse.json({
      ok: failed === 0,
      sent,
      failed,
      results,
      message: failed
        ? `Sent ${sent}, failed ${failed}.`
        : `Sent ${sent} agreement${sent === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    console.error("[shm-templates/bulk-send]", error);
    return NextResponse.json(templateApiError(error, "Could not bulk send contracts."), { status: 500 });
  }
}
