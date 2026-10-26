import { prisma } from "../prisma";
import { isPropertyManagementAgreement, logShmEvent } from "./documents";
import {
  sendPmaFinalSignedInfoEmail,
  sendPmaFinalSignedRecipientEmail,
} from "./mailer";

function parseAgreementData(raw: string | null | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  return JSON.stringify({ ...parseAgreementData(existingRaw), ...patch });
}

async function buildPmaFinalDocxAttachment(documentId: string) {
  try {
    const { buildPropertyManagementAgreementDashboardPreview } = await import(
      "./property-management-agreement-dashboard-preview"
    );
    const generated = await buildPropertyManagementAgreementDashboardPreview(documentId, "docx");
    if (!generated?.buffer.length) return [];
    return [
      {
        fileName: generated.fileName,
        fileContent: generated.buffer.toString("base64"),
        fileType: generated.fileType,
      },
    ];
  } catch (error) {
    console.error("[pma-final-delivery-emails] docx attachment failed", error);
    return [];
  }
}

/** After both parties signed and Drive upload confirmed — email owner + info@ with final PMA. */
export async function deliverPmaFinalSignedEmailsIfNeeded(
  documentId: string,
  fileUrl: string | null | undefined,
  request?: Request,
  options?: { force?: boolean },
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isPropertyManagementAgreement(doc.documentType)) return;

  const agreementData = parseAgreementData(doc.agreementData);
  const legacyDeliveryMarked = Boolean(agreementData.pma_final_delivery_emails_sent_at);
  const recipientAlreadySent =
    Boolean(agreementData.pma_final_recipient_email_sent_at) || legacyDeliveryMarked;
  const infoAlreadySent = Boolean(agreementData.pma_final_info_email_sent_at);
  if (recipientAlreadySent && infoAlreadySent && !options?.force) return;

  const recipientSigned =
    doc.signers.some((s) => s.signerType === "recipient" && s.status === "Signed")
    || Boolean(doc.tenantSignedAt || doc.signedAt);
  const creatorSigned =
    doc.signers.some((s) => s.signerType === "creator" && s.status === "Signed")
    || Boolean(doc.adminSignedAt);
  if (!recipientSigned || !creatorSigned) return;

  const attachments = await buildPmaFinalDocxAttachment(documentId);
  const driveUrl = String(fileUrl || doc.signedDriveUrl || "").trim() || null;

  const base = {
    documentId: doc.documentId,
    documentType: doc.documentType,
    propertyAddress: doc.propertyAddress,
    recipientName: doc.recipientName,
    recipientEmail: doc.recipientEmail,
    fileUrl: driveUrl,
    attachments,
  };

  const recipientResult =
    recipientAlreadySent && !options?.force
      ? { ok: true, skipped: false as const }
      : await sendPmaFinalSignedRecipientEmail({
          ...base,
          to: doc.recipientEmail,
          name: doc.recipientName,
        });

  if (!recipientAlreadySent || options?.force) {
    await logShmEvent(
      documentId,
      recipientResult.ok
        ? "pma_final_recipient_email_sent"
        : recipientResult.skipped
          ? "pma_final_recipient_email_skipped"
          : "pma_final_recipient_email_error",
      request,
    );
  }

  const infoResult =
    infoAlreadySent && !options?.force
      ? { ok: true, skipped: false as const }
      : await sendPmaFinalSignedInfoEmail(base);

  if (!infoAlreadySent || options?.force) {
    await logShmEvent(
      documentId,
      infoResult.ok
        ? "pma_final_info_email_sent"
        : infoResult.skipped
          ? "pma_final_info_email_skipped"
          : "pma_final_info_email_error",
      request,
    );
  }

  const patch: Record<string, unknown> = {};
  if (recipientResult.ok) {
    patch.pma_final_recipient_email_sent_at =
      agreementData.pma_final_recipient_email_sent_at || new Date().toISOString();
  }
  if (infoResult.ok) {
    patch.pma_final_info_email_sent_at =
      agreementData.pma_final_info_email_sent_at || new Date().toISOString();
  }
  if (recipientResult.ok && infoResult.ok) {
    patch.pma_final_delivery_emails_sent_at = new Date().toISOString();
  }
  if (Object.keys(patch).length) {
    await prisma.shmDocument.update({
      where: { documentId },
      data: { agreementData: mergeAgreementData(doc.agreementData, patch) },
    });
  }
}

/** When Drive/Make upload fails but both parties signed — still email final DOCX and clear ERROR if possible. */
export async function attemptPmaEmailRecoveryOnUploadFailure(
  documentId: string,
  request?: Request,
  options?: { forceEmail?: boolean },
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isPropertyManagementAgreement(doc.documentType)) return { ok: false as const, reason: "not_pma" };

  const recipientSigned =
    doc.signers.some((s) => s.signerType === "recipient" && s.status === "Signed")
    || Boolean(doc.tenantSignedAt || doc.signedAt);
  const creatorSigned =
    doc.signers.some((s) => s.signerType === "creator" && s.status === "Signed")
    || Boolean(doc.adminSignedAt);
  if (!recipientSigned || !creatorSigned) return { ok: false as const, reason: "not_fully_signed" };

  await deliverPmaFinalSignedEmailsIfNeeded(documentId, doc.signedDriveUrl, request, {
    force: options?.forceEmail,
  });

  const refreshed = await prisma.shmDocument.findUnique({
    where: { documentId },
    select: { agreementData: true },
  });
  const sentAt = parseAgreementData(refreshed?.agreementData).pma_final_delivery_emails_sent_at;
  if (sentAt) {
    await prisma.shmDocument.update({
      where: { documentId },
      data: { status: "Signed" },
    });
    await logShmEvent(documentId, "pma_final_recovery_signed_status", request);
    return { ok: true as const, emailsSent: true };
  }

  return { ok: false as const, reason: "emails_not_sent" };
}
