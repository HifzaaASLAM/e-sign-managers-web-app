import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { createShmDocument } from "../../../../lib/shm/create-shm-document";
import {
  BULK_SEND_MAX_RECIPIENTS,
  parseRecipientLines,
  type BulkRecipient,
} from "../../../../lib/shm/recipient-lines";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Create one document per recipient for any SHM document type. */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 });
    }

    const { user, company } = await getWorkspaceByEmail(session.user.email);
    if (!user || !company) {
      return NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const documentType = String(body.documentType || "").trim();
    const defaultPropertyAddress = String(body.propertyAddress || body.defaultPropertyAddress || "").trim();
    const defaultRecipientRole = String(body.recipientRole || body.defaultRecipientRole || "").trim();
    const rentAmount = String(body.rentAmount || "").trim() || undefined;
    const landlordName = String(body.landlordName || "").trim() || undefined;
    const landlordEmail = String(body.landlordEmail || "").trim() || undefined;

    if (!documentType) {
      return NextResponse.json({ ok: false, message: "Document type is required." }, { status: 400 });
    }

    let recipients: BulkRecipient[] = [];
    if (Array.isArray(body.recipients)) {
      recipients = body.recipients
        .map((row: Record<string, unknown>) => ({
          name: String(row.name || row.recipientName || row.tenant_name || "").trim(),
          email: String(row.email || row.recipientEmail || row.tenant_email || "").trim().toLowerCase(),
          propertyAddress: String(row.propertyAddress || row.premises_address || row.address || "").trim() || undefined,
          role: String(row.role || row.recipientRole || "").trim() || undefined,
        }))
        .filter((r: BulkRecipient) => r.name && r.email.includes("@"));
    } else if (typeof body.recipients_text === "string") {
      recipients = parseRecipientLines(body.recipients_text);
    }

    if (!recipients.length) {
      return NextResponse.json({
        ok: false,
        message: "Add at least one recipient (Name, Email, optional Property, optional Role — one per line).",
      }, { status: 400 });
    }

    if (recipients.length > BULK_SEND_MAX_RECIPIENTS) {
      return NextResponse.json({
        ok: false,
        message: `Bulk send is limited to ${BULK_SEND_MAX_RECIPIENTS} recipients at a time.`,
      }, { status: 400 });
    }

    const seen = new Set<string>();
    recipients = recipients.filter((r) => {
      const key = `${r.email}:${r.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const results: Array<{
      ok: boolean;
      name: string;
      email: string;
      documentId?: string;
      creatorSigningUrl?: string;
      emailStatus?: string;
      message?: string;
    }> = [];

    for (const recipient of recipients) {
      try {
        const propertyAddress = recipient.propertyAddress || defaultPropertyAddress || undefined;
        const created = await createShmDocument(
          {
            companyId: company.id,
            user: { id: user.id, name: user.name, email: user.email },
            documentType,
            recipientRole: recipient.role || defaultRecipientRole || undefined,
            propertyAddress,
            rentAmount,
            landlordName,
            landlordEmail,
            request,
          },
          { ...recipient, propertyAddress },
        );

        let message = "Created";
        if (created.adminFirst) {
          message = "Created — open creator form to fill and send";
        } else if (created.emailStatus === "sent") {
          message = "Email sent";
        } else if (created.emailStatus === "skipped") {
          message = created.emailMessage || "Created but email not sent (check RESEND_API_KEY)";
        } else if (created.emailStatus === "error") {
          message = created.emailMessage || "Created but email failed";
        }

        results.push({
          ok: true,
          name: created.recipientName,
          email: created.recipientEmail,
          documentId: created.documentId,
          creatorSigningUrl: created.creatorSigningUrl,
          emailStatus: created.emailStatus,
          message,
        });
      } catch (error) {
        results.push({
          ok: false,
          name: recipient.name,
          email: recipient.email,
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;
    const emailsSent = results.filter((r) => r.emailStatus === "sent").length;
    const creatorForms = results.filter((r) => r.creatorSigningUrl).length;

    return NextResponse.json({
      ok: failed === 0,
      sent,
      failed,
      emailsSent,
      creatorForms,
      results,
      message: failed
        ? `Created ${sent}, failed ${failed}.`
        : emailsSent
          ? `Created ${sent} document${sent === 1 ? "" : "s"} and sent ${emailsSent} email${emailsSent === 1 ? "" : "s"}.`
          : creatorForms
            ? `Created ${sent} document${sent === 1 ? "" : "s"}. Open each creator form from the list below to complete and send.`
            : `Created ${sent} document${sent === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not bulk create documents.";
    console.error("[shm-docs/bulk-create]", message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
