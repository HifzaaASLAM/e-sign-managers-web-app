import { NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/prisma";
import {
  isWithdrawn,
  requireDashboardDocument,
  stripAgreementSignatures,
} from "../../../../../../lib/dashboard/document-actions";
import {
  createToken,
  getSignUrl,
  isAdminFirstDocumentType,
  isOnePartySignedDocumentType,
  isPropertyManagementAgreement,
  isTenantAgreement,
  logShmEvent,
  nextShmDocumentId,
} from "../../../../../../lib/shm/documents";
import { loadTenantAgreementEmailAttachmentsForSend } from "../../../../../../lib/shm/tenant-agreement-email-attachments";
import { sendSigningEmail } from "../../../../../../lib/shm/mailer";
import { signingEmailContentForDocument } from "../../../../../../lib/shm/signing-email-templates";
import {
  markTenantSigningEmailDelivered,
  markTenantSigningEmailFailed,
} from "../../../../../../lib/shm/tenant-agreement-send";
import { isRevokedToken } from "../../../../../../lib/shm/signing-access";

export const dynamic = "force-dynamic";

type RouteContext = { params: { documentId: string } };

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function deleteDocumentSidecarRows(documentId: string) {
  try {
    await prisma.rentalApplicationDocument.deleteMany({ where: { documentId } });
  } catch (error) {
    console.warn("[dashboard/documents/actions] rentalApplicationDocument cleanup skipped", error);
  }
  try {
    await prisma.otpChallenge.deleteMany({ where: { documentId } });
  } catch (error) {
    console.warn("[dashboard/documents/actions] otpChallenge cleanup skipped", error);
  }
}

async function ensureRecipientSigningLink(doc: {
  documentId: string;
  documentType: string;
  status: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: string;
  tenantToken: string | null;
  token: string;
  signingUrl: string | null;
  tenantSigningUrl: string | null;
  signers: Array<{ id: string; signerType: string; token: string; status: string; signingUrl: string | null }>;
}) {
  const recipient = doc.signers.find((s) => s.signerType === "recipient");
  if (!recipient) {
    throw new Error("Recipient signer is missing on this document.");
  }
  if (recipient.status === "Signed") {
    throw new Error("Recipient has already signed.");
  }

  let token = recipient.token || doc.tenantToken || doc.token;
  if (!token || isRevokedToken(token)) {
    token = createToken();
  }
  const signingUrl = getSignUrl(doc.documentId, token, "recipient");

  await prisma.shmDocumentSigner.update({
    where: { id: recipient.id },
    data: {
      token,
      signingUrl,
      name: doc.recipientName,
      email: doc.recipientEmail,
      role: doc.recipientRole,
    },
  });

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: {
      token,
      tenantToken: token,
      signingUrl,
      tenantSigningUrl: signingUrl,
      status: isAdminFirstDocumentType(doc.documentType) ? "Awaiting Tenant" : doc.status,
    },
  });

  return signingUrl;
}

async function ensureCreatorSigningLink(doc: {
  documentId: string;
  adminToken: string | null;
  adminName: string | null;
  adminEmail: string | null;
  signers: Array<{ id: string; signerType: string; token: string; status: string; signingUrl: string | null; name: string; email: string }>;
}) {
  const creator = doc.signers.find((s) => s.signerType === "creator");
  if (!creator) {
    throw new Error("Creator signer is missing on this document.");
  }
  if (creator.status === "Signed") {
    throw new Error("Creator has already signed. Use Amend to create an editable copy.");
  }

  let token = creator.token || doc.adminToken;
  if (!token || isRevokedToken(token)) {
    token = createToken();
  }
  const signingUrl = getSignUrl(doc.documentId, token, "creator");

  await prisma.shmDocumentSigner.update({
    where: { id: creator.id },
    data: { token, signingUrl, status: "Not Signed" },
  });
  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: {
      adminToken: token,
      status: "Awaiting Creator Signature",
    },
  });

  return signingUrl;
}

export async function POST(request: Request, { params }: RouteContext) {
  const loaded = await requireDashboardDocument(params.documentId);
  if (loaded.error) {
    return jsonError(loaded.error.message, loaded.error.status);
  }

  const { user, doc } = loaded;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  if (!action) return jsonError("Action is required.", 400);
  if (isWithdrawn(doc.status) && action !== "clone" && action !== "delete") {
    return jsonError("This document was withdrawn. Clone it to start a new copy.", 400);
  }

  try {
    if (action === "delete") {
      await deleteDocumentSidecarRows(doc.documentId);
      await prisma.shmDocument.delete({ where: { documentId: doc.documentId } });
      return NextResponse.json({
        ok: true,
        message: "Document removed from dashboard.",
        redirectTo: "/dashboard",
      });
    }

    if (action === "withdraw") {
      if (String(doc.status).toLowerCase() === "signed") {
        return jsonError("Signed documents cannot be withdrawn. Clone and amend instead.", 400);
      }

      for (const signer of doc.signers) {
        const revoked = `revoked-${createToken()}`;
        await prisma.shmDocumentSigner.update({
          where: { id: signer.id },
          data: { token: revoked, signingUrl: null, status: signer.status === "Signed" ? "Signed" : "Withdrawn" },
        });
      }

      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: {
          status: "Withdrawn",
          adminToken: null,
          tenantToken: null,
          signingUrl: null,
          tenantSigningUrl: null,
          token: `revoked-${createToken()}`,
        },
      });
      await logShmEvent(doc.documentId, "withdrawn", request);
      return NextResponse.json({ ok: true, message: "Document withdrawn. Signing links are no longer valid." });
    }

    if (action === "resend") {
      const recipient = doc.signers.find((s) => s.signerType === "recipient");
      if (!recipient) return jsonError("No recipient to re-send to.", 400);
      if (recipient.status === "Signed") return jsonError("Recipient has already signed.", 400);
      if (!doc.recipientEmail?.includes("@")) return jsonError("Recipient email is missing. Edit the signer first.", 400);

      const signingUrl = await ensureRecipientSigningLink(doc);
      let resendAttachments: Array<{ fileName: string; fileContent: string; fileType: string }> | undefined;
      if (isTenantAgreement(doc.documentType) && doc.adminSignature) {
        let agreementData: Record<string, unknown> = {};
        try {
          agreementData = doc.agreementData ? JSON.parse(doc.agreementData) : {};
        } catch {
          agreementData = {};
        }
        const built = await loadTenantAgreementEmailAttachmentsForSend({
          documentId: doc.documentId,
          agreementData,
          adminSignature: doc.adminSignature,
          propertyAddress: doc.propertyAddress,
          adminName: doc.adminName,
          adminEmail: doc.adminEmail,
          tenantName: doc.recipientName,
          tenantEmail: doc.recipientEmail,
        });
        if (built.length) resendAttachments = built;
      }
      const signingEmail = signingEmailContentForDocument(doc.documentType, doc.agreementData);
      const emailResult = await sendSigningEmail({
        to: doc.recipientEmail,
        name: doc.recipientName,
        documentType: doc.documentType,
        signingUrl,
        propertyAddress: doc.propertyAddress,
        documentId: doc.documentId,
        creatorEmail: doc.adminEmail,
        creatorName: doc.adminName,
        attachments: resendAttachments,
        signingEmail,
      });
      await logShmEvent(
        doc.documentId,
        emailResult.ok ? "resent_to_recipient" : emailResult.skipped ? "resend_skipped" : "resend_error",
        request,
      );
      if (!emailResult.ok) {
        await markTenantSigningEmailFailed(doc.documentId);
        return NextResponse.json({
          ok: false,
          message: emailResult.message || "Could not send email. Direct signing link was refreshed.",
          signingUrl,
        }, { status: 500 });
      }
      await markTenantSigningEmailDelivered(doc.documentId);
      if (!isAdminFirstDocumentType(doc.documentType)) {
        await prisma.shmDocument.update({
          where: { documentId: doc.documentId },
          data: { status: "Sent" },
        });
      }
      return NextResponse.json({ ok: true, message: `Contract re-sent to ${doc.recipientEmail}.`, signingUrl });
    }

    if (action === "clone" || action === "amend") {
      const newDocumentId = await nextShmDocumentId();
      const oneParty = isOnePartySignedDocumentType(doc.documentType);
      const adminFirst = isAdminFirstDocumentType(doc.documentType);
      const pmaAmend = isPropertyManagementAgreement(doc.documentType) && action === "amend";
      const startAsDraft = adminFirst || pmaAmend;
      const recipientToken = createToken();
      const creatorToken = oneParty ? null : createToken();
      const signingUrl = getSignUrl(newDocumentId, recipientToken, "recipient");
      const creatorSigningUrl = creatorToken ? getSignUrl(newDocumentId, creatorToken, "creator") : null;
      const agreementData = stripAgreementSignatures(doc.agreementData);

      await prisma.shmDocument.create({
        data: {
          companyId: doc.companyId,
          createdById: user.id,
          documentId: newDocumentId,
          documentType: doc.documentType,
          recipientName: doc.recipientName,
          recipientEmail: doc.recipientEmail,
          recipientRole: doc.recipientRole,
          propertyAddress: doc.propertyAddress,
          status: startAsDraft ? "Draft" : "Sent",
          token: recipientToken,
          adminToken: creatorToken,
          tenantToken: recipientToken,
          signingUrl,
          tenantSigningUrl: signingUrl,
          adminName: doc.adminName || user.name || "Admin",
          adminEmail: doc.adminEmail || user.email,
          tenantName: doc.tenantName || doc.recipientName,
          tenantEmail: doc.tenantEmail || doc.recipientEmail,
          agreementData,
          sentAt: startAsDraft ? null : new Date(),
        },
      });

      type SignerInsert = {
        id: string;
        documentId: string;
        name: string;
        email: string;
        role: string;
        signerType: string;
        token: string;
        signingUrl: string | null;
        status: string;
        sentAt: Date | null;
      };

      const signerRows: SignerInsert[] = [
        {
          id: createToken(),
          documentId: newDocumentId,
          name: doc.recipientName,
          email: doc.recipientEmail,
          role: doc.recipientRole,
          signerType: "recipient",
          token: recipientToken,
          signingUrl,
          status: startAsDraft ? "Waiting" : "Sent",
          sentAt: startAsDraft ? null : new Date(),
        },
      ];

      if (!oneParty && creatorToken && creatorSigningUrl) {
        signerRows.unshift({
          id: createToken(),
          documentId: newDocumentId,
          name: doc.adminName || user.name || "Creator",
          email: doc.adminEmail || user.email || "",
          role: "Creator",
          signerType: "creator",
          token: creatorToken,
          signingUrl: creatorSigningUrl,
          status: "Not Signed",
          sentAt: null,
        });
      }

      await prisma.shmDocumentSigner.createMany({ data: signerRows });
      await logShmEvent(newDocumentId, `${action}_from_${doc.documentId}`, request);
      await logShmEvent(doc.documentId, `${action}_to_${newDocumentId}`, request);

      const amendOpenUrl = action === "amend" ? (creatorSigningUrl || signingUrl) : null;

      return NextResponse.json({
        ok: true,
        message: action === "amend"
          ? pmaAmend
            ? "Amended copy created as Draft. Edit terms, then use Send to Owner on Part F."
            : "Amended copy created. Opening the editable form."
          : "Document cloned.",
        documentId: newDocumentId,
        redirectTo: amendOpenUrl || `/dashboard/documents/${encodeURIComponent(newDocumentId)}`,
        openExternal: Boolean(amendOpenUrl),
      });
    }

    if (action === "update_signer") {
      const recipient = doc.signers.find((s) => s.signerType === "recipient");
      if (!recipient) return jsonError("Recipient not found.", 400);
      if (recipient.status === "Signed") return jsonError("Cannot edit a signer who has already signed.", 400);

      const name = String(body?.name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const role = String(body?.role || doc.recipientRole || "Tenant").trim();
      if (!name || !email) return jsonError("Name and email are required.", 400);

      const token = !recipient.token || isRevokedToken(recipient.token) ? createToken() : recipient.token;
      const signingUrl = getSignUrl(doc.documentId, token, "recipient");

      await prisma.shmDocumentSigner.update({
        where: { id: recipient.id },
        data: { name, email, role, token, signingUrl, status: recipient.status === "Removed" ? "Waiting" : recipient.status },
      });
      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: {
          recipientName: name,
          recipientEmail: email,
          recipientRole: role,
          tenantName: name,
          tenantEmail: email,
          token,
          tenantToken: token,
          signingUrl,
          tenantSigningUrl: signingUrl,
        },
      });
      await logShmEvent(doc.documentId, "recipient_updated", request);
      return NextResponse.json({ ok: true, message: "Signer details updated." });
    }

    if (action === "remove_signer") {
      const recipient = doc.signers.find((s) => s.signerType === "recipient");
      if (!recipient) return jsonError("Recipient not found.", 400);
      if (recipient.status === "Signed") return jsonError("Cannot remove a signer who has already signed.", 400);

      const revoked = `revoked-${createToken()}`;
      await prisma.shmDocumentSigner.update({
        where: { id: recipient.id },
        data: { token: revoked, signingUrl: null, status: "Removed" },
      });
      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: {
          tenantToken: null,
          tenantSigningUrl: null,
          signingUrl: null,
          status: isAdminFirstDocumentType(doc.documentType) ? "Awaiting Creator Signature" : "Draft",
        },
      });
      await logShmEvent(doc.documentId, "recipient_removed", request);
      return NextResponse.json({ ok: true, message: "Recipient removed. Use Add signer to invite someone else." });
    }

    if (action === "add_signer") {
      const recipients = doc.signers.filter((s) => s.signerType === "recipient");
      const openSlot = recipients.find(
        (s) => s.status === "Removed" || s.status === "Waiting" || s.status === "Not Sent" || !String(s.email || "").includes("@"),
      );
      const activeUnsigned = recipients.find(
        (s) => s.status !== "Signed" && s.status !== "Removed" && String(s.email || "").includes("@"),
      );
      const name = String(body?.name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const role = String(body?.role || "Tenant").trim() || "Tenant";

      if (activeUnsigned && !openSlot) {
        return jsonError("This document already has an unsigned recipient. Use Edit to change their details.", 400);
      }
      if (!name || !email) return jsonError("Name and email are required.", 400);
      if (recipients.filter((s) => s.status !== "Removed").length >= 5) {
        return jsonError("Maximum of 5 signers reached for this document.", 400);
      }

      const token = createToken();
      const signingUrl = getSignUrl(doc.documentId, token, "recipient");
      const isPrimaryUpdate = Boolean(openSlot) || recipients.length === 0;

      if (openSlot) {
        await prisma.shmDocumentSigner.update({
          where: { id: openSlot.id },
          data: { name, email, role, token, signingUrl, status: "Sent", sentAt: new Date() },
        });
      } else {
        await prisma.shmDocumentSigner.create({
          data: {
            id: createToken(),
            documentId: doc.documentId,
            name,
            email,
            role,
            signerType: "recipient",
            token,
            signingUrl,
            status: "Sent",
            sentAt: new Date(),
          },
        });
        // Additional signer while others already signed → wait for the new signature.
        if (doc.status === "Awaiting Creator Signature" || doc.status === "Signed" || doc.status === "Processing") {
          await prisma.shmDocument.update({
            where: { documentId: doc.documentId },
            data: { status: "Awaiting Recipient Signature" },
          });
        }
      }

      // Keep document-level recipient fields pointing at the primary/open-slot invite.
      if (isPrimaryUpdate) {
        await prisma.shmDocument.update({
          where: { documentId: doc.documentId },
          data: {
            recipientName: name,
            recipientEmail: email,
            recipientRole: role,
            tenantName: name,
            tenantEmail: email,
            token,
            tenantToken: token,
            signingUrl,
            tenantSigningUrl: signingUrl,
            tenantSentAt: new Date(),
            sentAt: new Date(),
            status: doc.status === "Draft" || doc.status === "Awaiting Creator Signature"
              ? doc.status
              : "Sent",
          },
        });
      } else {
        await logShmEvent(doc.documentId, "additional_signer_added", request);
      }

      const signingEmail = signingEmailContentForDocument(doc.documentType, doc.agreementData);
      const emailResult = await sendSigningEmail({
        to: email,
        name,
        documentType: doc.documentType,
        signingUrl,
        propertyAddress: doc.propertyAddress,
        documentId: doc.documentId,
        creatorEmail: doc.adminEmail,
        creatorName: doc.adminName,
        signingEmail,
      });
      await logShmEvent(doc.documentId, emailResult.ok ? "signer_added_email_sent" : "signer_added", request);

      return NextResponse.json({
        ok: true,
        message: emailResult.ok
          ? `Signer added and invitation emailed to ${email}.`
          : `Signer added. Email was not sent: ${emailResult.message || "check email settings"}.`,
        signingUrl,
      });
    }

    if (action === "retry_pma_finalize") {
      if (!isPropertyManagementAgreement(doc.documentType)) {
        return jsonError("This action only applies to Property Management Agreements.", 400);
      }
      const { attemptPmaEmailRecoveryOnUploadFailure } = await import(
        "../../../../../../lib/shm/pma-final-delivery-emails"
      );
      const recovery = await attemptPmaEmailRecoveryOnUploadFailure(doc.documentId, request, {
        forceEmail: true,
      });
      if (!recovery.ok) {
        return jsonError(
          recovery.reason === "not_fully_signed"
            ? "Both owner and agency must be signed before final delivery."
            : "Could not send final emails. Check RESEND_API_KEY and document signatures.",
          502,
        );
      }
      await logShmEvent(doc.documentId, "pma_finalize_retried_from_dashboard", request);
      return NextResponse.json({
        ok: true,
        message: "Final Property Management Agreement emailed to the owner and info@ inbox.",
      });
    }

    if (action === "open_amend_or_sign") {
      const oneParty = isOnePartySignedDocumentType(doc.documentType);

      // One-party forms (Rental Reference, PM Takeover, etc.) have no creator signature step.
      if (oneParty) {
        const recipient = doc.signers.find((s) => s.signerType === "recipient");
        if (recipient?.status === "Signed" || doc.tenantSignedAt || doc.signedAt) {
          return NextResponse.json({
            ok: true,
            useAction: "amend",
            message: "Form already submitted; create an amended copy.",
          });
        }
        const signingUrl = await ensureRecipientSigningLink(doc);
        return NextResponse.json({
          ok: true,
          message: "Opening form to amend.",
          redirectTo: signingUrl,
          openExternal: true,
        });
      }

      const creator = doc.signers.find((s) => s.signerType === "creator");
      if (creator && creator.status !== "Signed") {
        const signingUrl = await ensureCreatorSigningLink(doc);
        return NextResponse.json({
          ok: true,
          message: "Opening creator signing page to amend.",
          redirectTo: signingUrl,
          openExternal: true,
        });
      }
      return NextResponse.json({ ok: true, useAction: "amend", message: "Creator already signed; create an amended copy." });
    }

    return jsonError(`Unknown action: ${action}`, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    console.error("[dashboard/documents/actions]", action, message);
    return jsonError(message, 500);
  }
}
