import { prisma } from "../prisma";
import {
  ensureDriveFolder,
  getDriveParentFolderId,
  isDriveDirectUploadConfigured,
  uploadFileToDriveFolder,
} from "./google-drive";
import {
  isOnePartySignedDocumentType,
  isTenantAgreement,
  logShmEvent,
  rollupDocumentStatus,
  tenantAgreementAllRecipientsSigned,
} from "./documents";
import { sendAdminFinalFileReadyEmail } from "./mailer";
import { normalizeFileType, sanitizeDriveLabel, stripDataUri } from "./make";

type DeliveryDoc = {
  documentId: string;
  documentType: string;
  recipientName: string;
  recipientEmail: string;
  adminName?: string | null;
  adminEmail?: string | null;
  propertyAddress?: string | null;
};

type DeliveryAttachment = { fileName: string; fileType?: string; fileContent: string };

type DeliveryInput = {
  doc: DeliveryDoc;
  fileName: string;
  fileContent: string;
  fileType?: string;
  recipient?: { name?: string; email?: string };
  attachments?: DeliveryAttachment[];
  signerName?: string;
  driveFolderName?: string;
};

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
}

function resolveDriveFolderName(input: DeliveryInput) {
  if (input.driveFolderName?.trim()) return sanitizeDriveLabel(input.driveFolderName);
  const signer =
    sanitizeDriveLabel(input.signerName || input.recipient?.name || input.doc.recipientName || "Signer") || "Signer";
  return sanitizeDriveLabel(`${input.doc.documentId} - ${input.doc.documentType} - ${signer}`) || "Signed Document";
}

/**
 * Upload the final signed file straight to Google Drive (no Make.com).
 * Returns ok:false on any failure so callers can fall back to Make safely.
 */
export async function deliverFinalDocumentDirectToDrive(input: DeliveryInput, request: Request) {
  if (!isDriveDirectUploadConfigured()) {
    return { ok: false as const, status: 503, message: "Direct Drive upload is not configured.", details: "" };
  }

  const fileContent = stripDataUri(input.fileContent);
  if (!fileContent) {
    return { ok: false as const, status: 400, message: "Missing file content for Drive upload.", details: "" };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContent, "base64");
  } catch {
    return { ok: false as const, status: 400, message: "Invalid file content for Drive upload.", details: "" };
  }
  if (!buffer.length) {
    return { ok: false as const, status: 400, message: "Empty file content for Drive upload.", details: "" };
  }

  const fileName = String(input.fileName || "document").trim() || "document";
  const fileType = normalizeFileType(input.fileType, fileName);
  const folderName = resolveDriveFolderName(input);
  const parentId = getDriveParentFolderId() || undefined;

  const folder = await ensureDriveFolder(folderName, parentId);
  const mainFile = await uploadFileToDriveFolder({
    name: fileName,
    mimeType: fileType,
    buffer,
    folderId: folder.id,
  });

  const uploadedAttachments: Array<{ fileName: string; fileId: string; fileUrl: string }> = [];
  for (const attachment of input.attachments || []) {
    const raw = stripDataUri(attachment.fileContent);
    if (!raw) continue;
    const attBuffer = Buffer.from(raw, "base64");
    if (!attBuffer.length) continue;
    const attName = String(attachment.fileName || "attachment").trim() || "attachment";
    const uploaded = await uploadFileToDriveFolder({
      name: attName,
      mimeType: normalizeFileType(attachment.fileType, attName),
      buffer: attBuffer,
      folderId: folder.id,
    });
    uploadedAttachments.push({ fileName: attName, fileId: uploaded.id, fileUrl: uploaded.url });
  }

  const existing = await prisma.shmDocument.findUnique({
    where: { documentId: input.doc.documentId },
    include: { signers: true },
  });
  if (!existing) {
    return { ok: false as const, status: 404, message: "Document not found after Drive upload.", details: "" };
  }

  const onePartySigned = isOnePartySignedDocumentType(existing.documentType);
  const recipientSigners = existing.signers.filter((signer) => signer.signerType !== "creator");
  const recipientSigned =
    recipientSigners.length > 0
      ? recipientSigners.every((signer) => signer.status === "Signed")
      : Boolean(existing.tenantSignedAt || existing.signedAt);
  const creatorSigned =
    existing.signers.some((signer) => signer.signerType === "creator" && signer.status === "Signed") ||
    Boolean(existing.adminSignedAt);
  const taComplete = isTenantAgreement(existing.documentType)
    ? tenantAgreementAllRecipientsSigned(existing.signers)
    : false;
  const complete = onePartySigned
    ? recipientSigned
    : isTenantAgreement(existing.documentType)
      ? taComplete
      : recipientSigned && creatorSigned;
  const nextStatus = complete ? "Signed" : rollupDocumentStatus(existing.signers, undefined, existing.documentType);

  await prisma.shmDocument.update({
    where: { documentId: input.doc.documentId },
    data: {
      status: nextStatus,
      signedDriveUrl: complete
        ? folder.url || mainFile.url || existing.signedDriveUrl
        : existing.signedDriveUrl,
      signedAt: complete ? new Date() : existing.signedAt,
      agreementData: mergeAgreementData(existing.agreementData, {
        drive_folder_id: folder.id,
        drive_folder_url: folder.url,
        main_file_id: mainFile.id,
        main_file_url: mainFile.url,
        uploaded_attachments: uploadedAttachments,
        last_drive_upload_at: new Date().toISOString(),
        delivery_path: "direct_drive",
      }),
    },
  });

  await logShmEvent(input.doc.documentId, "drive_file_saved", request);
  await logShmEvent(input.doc.documentId, complete ? "signed_complete" : "partial_signed_file_ready", request);

  if (complete) {
    try {
      const { isPropertyManagementAgreement } = await import("./documents");
      if (isPropertyManagementAgreement(existing.documentType)) {
        const { deliverPmaFinalSignedEmailsIfNeeded } = await import("./pma-final-delivery-emails");
        await deliverPmaFinalSignedEmailsIfNeeded(
          input.doc.documentId,
          folder.url || mainFile.url,
          request,
        );
      }
      if (isTenantAgreement(existing.documentType)) {
        const { deliverTenantAgreementFinalSignedEmailsIfNeeded } = await import("./ta-final-delivery-emails");
        await deliverTenantAgreementFinalSignedEmailsIfNeeded(
          input.doc.documentId,
          folder.url || mainFile.url,
          request,
        );
      }
    } catch (error) {
      console.error("[drive-delivery] PMA final delivery emails failed", error);
    }
  }

  if (complete && (folder.url || mainFile.url) && existing.adminEmail) {
    const adminEmailResult = await sendAdminFinalFileReadyEmail({
      to: existing.adminEmail,
      adminName: existing.adminName,
      documentId: existing.documentId,
      documentType: existing.documentType,
      propertyAddress: existing.propertyAddress,
      signerName: input.recipient?.name || existing.recipientName,
      signerEmail: input.recipient?.email || existing.recipientEmail,
      fileUrl: folder.url || mainFile.url,
    });
    await logShmEvent(
      input.doc.documentId,
      adminEmailResult.ok
        ? "admin_final_file_ready_email_sent"
        : adminEmailResult.skipped
          ? "admin_final_file_ready_email_skipped"
          : "admin_final_file_ready_email_error",
      request,
    );
  }

  return {
    ok: true as const,
    status: 200,
    message: "File uploaded directly to Google Drive.",
    drive_folder_url: folder.url,
    file_url: mainFile.url,
    delivery: "direct_drive" as const,
  };
}
