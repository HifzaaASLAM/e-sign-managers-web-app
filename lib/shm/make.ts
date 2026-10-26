import { prisma } from "../prisma";
import { logShmEvent, getAppUrl } from "./documents";
import { stripDataUri } from "./file-content";
import { getDriveParentFolderId } from "./google-drive";

type MakePayloadInput = {
  doc: {
    documentId: string;
    documentType: string;
    recipientName: string;
    recipientEmail: string;
    adminName?: string | null;
    adminEmail?: string | null;
    propertyAddress?: string | null;
  };
  token: string;
  fileName: string;
  fileContent: string;
  fileType?: string;
  recipient?: { name?: string; email?: string };
  attachments?: Array<{ fileName: string; fileType?: string; fileContent: string }>;
  signerName?: string;
  driveFolderName?: string;
};

const MAKE_WEBHOOK_BYTE_LIMIT = 4_500_000;
const MAKE_WEBHOOK_TIMEOUT_MS = 120_000;
/** Raw file bytes that fit in a Make webhook after base64 + JSON overhead (~3 MB). */
export const MAKE_ATTACHMENT_RAW_BYTE_LIMIT = 3 * 1024 * 1024;

export { stripDataUri } from "./file-content";

export function normalizeFileType(fileType?: string, fileName?: string) {
  const provided = String(fileType || "").trim();
  if (provided) return provided;
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/pdf";
}

/** Strip duplicate extensions (e.g. name.pdf.pdf.docx) and return a single clean filename. */
export function normalizeMakeDriveFileName(fileName: string, preferredExt = "pdf") {
  const ext = preferredExt.replace(/^\./, "").toLowerCase();
  let stem = String(fileName || "document").trim().replace(/[\\/:*?"<>|]+/g, "-");
  stem = stem.replace(/(\.(pdf|docx|png|jpe?g|txt|doc))+$/gi, "");
  return `${stem}.${ext}`;
}

export function makeFileStem(fileName: string) {
  return normalizeMakeDriveFileName(fileName, "pdf").replace(/\.pdf$/i, "");
}

export function sanitizeDriveLabel(value: string) {
  return String(value || "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
}

/** One Drive folder per PM takeover submission, named after the signer. */
export function buildPmTakeoverDriveFolderName(signerName: string) {
  const clean = sanitizeDriveLabel(signerName) || "Signer";
  return `PM Takeover - ${clean}`;
}

export function buildPmTakeoverDriveFolderKey(docId: string) {
  return `pm-takeover:${docId}`;
}

/** One Drive folder per rental reference submission, named after the signer. */
export function buildRentalReferenceDriveFolderName(signerName: string) {
  const clean = sanitizeDriveLabel(signerName) || "Signer";
  return `Rental Reference - ${clean}`;
}

export function buildRentalReferenceDriveFolderKey(docId: string) {
  return `rental-reference:${docId}`;
}

export function buildTenantAgreementDriveFolderKey(docId: string) {
  return `tenant-agreement:${docId}`;
}

export function buildTenantAgreementDriveFolderName(tenantName: string) {
  const clean = sanitizeDriveLabel(tenantName) || "Tenant";
  return `Tenant Agreement - ${clean}`;
}

export function buildPropertyManagementAgreementDriveFolderKey(docId: string) {
  return `property-management-agreement:${docId}`;
}

export function buildPropertyManagementAgreementDriveFolderName(ownerName: string) {
  const clean = sanitizeDriveLabel(ownerName) || "Owner";
  return `Property Management Agreement - ${clean}`;
}

function isPmTakeoverDocumentType(documentType: string) {
  return documentType.trim().toLowerCase() === "pm takeover form";
}

function isRentalReferenceDocumentType(documentType: string) {
  return documentType.trim().toLowerCase() === "rental reference form";
}

function isSelfServiceDocxFormDocumentType(documentType: string) {
  return isPmTakeoverDocumentType(documentType) || isRentalReferenceDocumentType(documentType);
}

function isTenantAgreementDocumentType(documentType: string) {
  return documentType.trim().toLowerCase() === "tenant agreement";
}

function isPropertyManagementAgreementDocumentType(documentType: string) {
  return documentType.trim().toLowerCase() === "property management agreement";
}

export function isPdfBase64(fileContent: string) {
  const raw = stripDataUri(fileContent);
  if (!raw) return false;
  try {
    const head = Buffer.from(raw.slice(0, 24), "base64").toString("ascii");
    return head.startsWith("%PDF");
  } catch {
    return false;
  }
}

export function isDocxBase64(fileContent: string) {
  const raw = stripDataUri(fileContent);
  if (!raw) return false;
  try {
    const head = Buffer.from(raw.slice(0, 24), "base64").toString("ascii");
    return head.startsWith("PK");
  } catch {
    return false;
  }
}

function normalizedAttachments(attachments: MakePayloadInput["attachments"]) {
  return (attachments || []).map((attachment) => ({
    fileName: attachment.fileName,
    fileType: normalizeFileType(attachment.fileType, attachment.fileName),
    fileContent: stripDataUri(attachment.fileContent),
  }));
}

export function buildMakePayload({
  doc,
  token,
  fileName,
  fileContent,
  fileType,
  recipient,
  attachments,
  signerName,
  driveFolderName: driveFolderNameInput,
  options,
}: MakePayloadInput & {
  options?: {
    isMainDocument?: boolean;
    isSupportingAttachment?: boolean;
    mainDocumentFileName?: string;
    includeAttachments?: boolean;
  };
}) {
  const cleanContent = stripDataUri(fileContent);
  const pmTakeover = isPmTakeoverDocumentType(doc.documentType);
  const rentalReference = isRentalReferenceDocumentType(doc.documentType);
  const selfServiceDocxForm = pmTakeover || rentalReference;
  const tenantAgreement = isTenantAgreementDocumentType(doc.documentType);
  const propertyManagementAgreement = isPropertyManagementAgreementDocumentType(doc.documentType);
  const normalizedInputType = normalizeFileType(fileType, fileName);
  const uploadAsPdf = normalizedInputType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const pdfDriveUpload = selfServiceDocxForm && uploadAsPdf;
  const driveFileName = selfServiceDocxForm
    ? normalizeMakeDriveFileName(fileName, uploadAsPdf ? "pdf" : "docx")
    : fileName;
  const cleanType = selfServiceDocxForm ? normalizedInputType : normalizeFileType(fileType, driveFileName);
  const attachmentRows = options?.includeAttachments === false ? [] : normalizedAttachments(attachments);
  const manifest = (attachments || []).map((attachment) => ({
    fileName: attachment.fileName,
    fileType: normalizeFileType(attachment.fileType, attachment.fileName),
  }));
  const signerLabel = sanitizeDriveLabel(signerName || recipient?.name || doc.recipientName || "Signer") || "Signer";
  const driveFolderName = driveFolderNameInput
    || (pmTakeover
      ? buildPmTakeoverDriveFolderName(signerLabel)
      : rentalReference
        ? buildRentalReferenceDriveFolderName(signerLabel)
      : tenantAgreement
        ? buildTenantAgreementDriveFolderName(signerLabel)
        : propertyManagementAgreement
          ? buildPropertyManagementAgreementDriveFolderName(signerLabel)
          : `${doc.documentId} - ${doc.documentType} - ${signerLabel}`);
  // Always resolve a real Drive folder ID for Make. Empty parent causes:
  // Google API 400 "The specified parent is not a folder."
  const parentFolderId = getDriveParentFolderId();

  const payload: Record<string, unknown> = {
    doc_id: doc.documentId,
    token,
    documentType: doc.documentType,
    document_type: doc.documentType,
    fileName: driveFileName,
    fileContent: cleanContent,
    file_content: cleanContent,
    fileType: cleanType,
    file_type: cleanType,
    recipient: {
      name: recipient?.name || doc.recipientName,
      email: recipient?.email || doc.recipientEmail,
    },
    callback_url: `${getAppUrl()}/api/shm-docs/drive-callback`,
    secret_key: process.env.MAKE_CALLBACK_SECRET || "",
    driveFolderName,
    drive_folder_name: driveFolderName,
    folder_name: driveFolderName,
    folderName: driveFolderName,
    google_drive_folder_name: driveFolderName,
    signer_name: signerLabel,
    attachmentCount: manifest.length,
    attachment_manifest: manifest,
    attachments: attachmentRows,
    is_main_document: options?.isMainDocument ?? true,
    is_supporting_attachment: options?.isSupportingAttachment ?? false,
    main_document_file_name: options?.mainDocumentFileName || driveFileName,
    mainFile: {
      fileName: driveFileName,
      fileContent: cleanContent,
      fileType: cleanType,
    },
    drive_file_name: driveFileName,
    driveFileName: driveFileName,
    google_drive_mime_type: cleanType,
    mime_type: cleanType,
    parent_folder_id: parentFolderId,
    drive_parent_folder_id: parentFolderId,
    google_drive_parent_folder_id: parentFolderId,
  };

  if (pmTakeover && !options?.isSupportingAttachment) {
    const stem = uploadAsPdf
      ? makeFileStem(fileName)
      : normalizeMakeDriveFileName(fileName, "docx").replace(/\.docx$/i, "");
    Object.assign(payload, {
      flow_type: "pm_takeover_form",
      make_file_stem: stem,
      drive_file_name_stem: stem,
      save_as_filename: driveFileName,
      append_pdf_extension: uploadAsPdf,
      output_format: uploadAsPdf ? "pdf" : "docx",
      save_as_pdf: uploadAsPdf,
      convert_to_docx: !uploadAsPdf,
      upload_as_pdf: uploadAsPdf,
      content_encoding: "base64",
      content_is_pdf: uploadAsPdf,
      is_raw_pdf_base64: uploadAsPdf,
      file_extension: uploadAsPdf ? "pdf" : "docx",
      google_drive_convert: false,
      drive_mime_type: cleanType,
      google_drive_upload_mime_type: cleanType,
      create_drive_folder: true,
      use_existing_drive_folder: false,
      drive_folder_key: buildPmTakeoverDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
      upload_to_folder: true,
    });
  }

  if (rentalReference && !options?.isSupportingAttachment) {
    const stem = uploadAsPdf
      ? makeFileStem(fileName)
      : normalizeMakeDriveFileName(fileName, "docx").replace(/\.docx$/i, "");
    Object.assign(payload, {
      flow_type: "rental_reference_form",
      make_file_stem: stem,
      drive_file_name_stem: stem,
      save_as_filename: driveFileName,
      append_pdf_extension: uploadAsPdf,
      output_format: uploadAsPdf ? "pdf" : "docx",
      save_as_pdf: uploadAsPdf,
      convert_to_docx: !uploadAsPdf,
      upload_as_pdf: uploadAsPdf,
      content_encoding: "base64",
      content_is_pdf: uploadAsPdf,
      is_raw_pdf_base64: uploadAsPdf,
      file_extension: uploadAsPdf ? "pdf" : "docx",
      google_drive_convert: false,
      drive_mime_type: cleanType,
      google_drive_upload_mime_type: cleanType,
      create_drive_folder: true,
      use_existing_drive_folder: false,
      drive_folder_key: buildRentalReferenceDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
      upload_to_folder: true,
    });
  }

  if (tenantAgreement && !options?.isSupportingAttachment) {
    Object.assign(payload, {
      create_drive_folder: true,
      use_existing_drive_folder: false,
      drive_folder_key: buildTenantAgreementDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
      upload_to_folder: true,
    });
  }

  if (propertyManagementAgreement && !options?.isSupportingAttachment) {
    const uploadAsPdf = cleanType === "application/pdf" || driveFileName.toLowerCase().endsWith(".pdf");
    Object.assign(payload, {
      flow_type: "property_management_agreement",
      create_drive_folder: true,
      use_existing_drive_folder: false,
      drive_folder_key: buildPropertyManagementAgreementDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
      upload_to_folder: true,
      output_format: uploadAsPdf ? "pdf" : "docx",
      save_as_pdf: uploadAsPdf,
      convert_to_docx: !uploadAsPdf,
      upload_as_pdf: uploadAsPdf,
      content_encoding: "base64",
      file_extension: uploadAsPdf ? "pdf" : "docx",
      google_drive_mime_type: cleanType,
      drive_mime_type: cleanType,
      google_drive_upload_mime_type: cleanType,
    });
  }

  if (pmTakeover && options?.isSupportingAttachment) {
    Object.assign(payload, {
      upload_to_folder: true,
      preserve_original_filename: true,
      create_drive_folder: false,
      use_existing_drive_folder: true,
      drive_folder_key: buildPmTakeoverDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
    });
  }

  if (rentalReference && options?.isSupportingAttachment) {
    Object.assign(payload, {
      upload_to_folder: true,
      preserve_original_filename: true,
      create_drive_folder: false,
      use_existing_drive_folder: true,
      drive_folder_key: buildRentalReferenceDriveFolderKey(doc.documentId),
      parent_folder_id: parentFolderId || undefined,
      drive_parent_folder_id: parentFolderId || undefined,
    });
  }

  return payload;
}

function payloadByteSize(payload: Record<string, unknown>) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function decodeBase64ByteLength(base64Input: string) {
  const clean = stripDataUri(base64Input);
  if (!clean) return 0;
  try {
    return Buffer.from(clean, "base64").length;
  } catch {
    return 0;
  }
}

/** Make payload embeds file bytes multiple times; large PMA templates exceed the webhook limit unless slimmed. */
function slimMakePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const fileContent = payload.fileContent;
  const mainFile = payload.mainFile;
  const slim: Record<string, unknown> = { ...payload };

  slim.fileContent = fileContent;
  delete slim.file_content;

  if (mainFile && typeof mainFile === "object") {
    slim.mainFile = {
      fileName: (mainFile as Record<string, unknown>).fileName,
      fileType: (mainFile as Record<string, unknown>).fileType,
    };
  }

  return slim;
}

function preparePayloadForMakeWebhook(payload: Record<string, unknown>) {
  if (payloadByteSize(payload) <= MAKE_WEBHOOK_BYTE_LIMIT) {
    return payload;
  }
  return slimMakePayload(payload);
}

export function selectPropertyManagementMakeUpload(input: {
  pdfContent?: string;
  pdfType?: string;
  pdfName?: string;
  docxContent?: string;
}) {
  const pdfBytes = decodeBase64ByteLength(input.pdfContent || "");
  const docxBytes = decodeBase64ByteLength(input.docxContent || "");
  const pdfName = input.pdfName || "Property-Management-Agreement.pdf";

  if (input.docxContent && (!input.pdfContent || docxBytes <= pdfBytes)) {
    return {
      fileName: normalizeMakeDriveFileName(pdfName, "docx"),
      fileContent: stripDataUri(input.docxContent),
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  return {
    fileName: normalizeMakeDriveFileName(pdfName, "pdf"),
    fileContent: stripDataUri(input.pdfContent || ""),
    fileType: normalizeFileType(input.pdfType, pdfName),
  };
}

async function postMakeWebhook(webhookUrl: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAKE_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false as const, status: response.status, message: `Make webhook failed with status ${response.status}.`, details: text };
    }

    return { ok: true as const, status: 200, message: "Payload sent to Make." };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false as const,
      status: aborted ? 504 : 502,
      message: aborted ? "Make webhook timed out while uploading document to Drive. Please try again." : "Could not reach Make webhook.",
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendSupportingAttachmentToMake(
  input: {
    doc: MakePayloadInput["doc"];
    token: string;
    mainFileName: string;
    attachment: { fileName: string; fileType?: string; fileContent: string };
    recipient?: { name?: string; email?: string };
    signerName?: string;
    driveFolderName?: string;
  },
  request: Request,
) {
  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  if (!webhookUrl) {
    await logShmEvent(input.doc.documentId, "make_webhook_missing", request);
    return { ok: false as const, status: 500, message: "MAKE_WEBHOOK_URL is not configured.", details: "" };
  }

  const fileContent = stripDataUri(input.attachment.fileContent);
  const fileName = input.attachment.fileName || "attachment";
  const fileType = normalizeFileType(input.attachment.fileType, fileName);
  const mainDocumentFileName = normalizeMakeDriveFileName(input.mainFileName, "pdf");

  const payload = preparePayloadForMakeWebhook(buildMakePayload({
    doc: input.doc,
    token: input.token,
    fileName,
    fileContent,
    fileType,
    recipient: input.recipient,
    signerName: input.signerName,
    driveFolderName: input.driveFolderName,
    attachments: [],
    options: {
      isMainDocument: false,
      isSupportingAttachment: true,
      mainDocumentFileName,
      includeAttachments: false,
    },
  }));

  if (payloadByteSize(payload) > MAKE_WEBHOOK_BYTE_LIMIT) {
    return {
      ok: false as const,
      status: 413,
      message: `${fileName} is too large to upload (max ~3 MB per file). Please use a smaller file.`,
      details: "",
    };
  }

  const result = await postMakeWebhook(webhookUrl, payload);
  if (!result.ok) {
    await logShmEvent(input.doc.documentId, `make_attachment_error_${result.status}`, request);
    return result;
  }

  await logShmEvent(input.doc.documentId, "attachment_payload_sent_to_make", request);
  return result;
}

export async function sendPayloadToMake(input: MakePayloadInput, request: Request) {
  // Live-safe dual path: try direct Google Drive first when configured.
  // If anything fails, fall through to Make.com so existing production never stops.
  try {
    const { isDriveDirectUploadConfigured } = await import("./google-drive");
    if (isDriveDirectUploadConfigured()) {
      const { deliverFinalDocumentDirectToDrive } = await import("./drive-delivery");
      const direct = await deliverFinalDocumentDirectToDrive(
        {
          doc: input.doc,
          fileName: input.fileName,
          fileContent: input.fileContent,
          fileType: input.fileType,
          recipient: input.recipient,
          attachments: input.attachments,
          signerName: input.signerName,
          driveFolderName: input.driveFolderName,
        },
        request,
      );
      if (direct.ok) {
        await logShmEvent(input.doc.documentId, "final_payload_sent_to_drive_direct", request);
        await afterPmaDirectDriveSuccess(
          input.doc.documentId,
          input.doc.documentType,
          direct.file_url || direct.drive_folder_url,
          request,
        );
        return { ok: true, status: 200, message: direct.message, delivery: "direct_drive" as const };
      }
      await logShmEvent(input.doc.documentId, "direct_drive_failed_fallback_make", request);
      console.warn("[sendPayloadToMake] direct Drive failed, falling back to Make:", direct.message, direct.details);
    }
  } catch (error) {
    console.error("[sendPayloadToMake] direct Drive exception, falling back to Make:", error);
    await logShmEvent(input.doc.documentId, "direct_drive_exception_fallback_make", request);
  }

  const webhookUrl = process.env.MAKE_WEBHOOK_URL;

  if (!webhookUrl) {
    await prisma.shmDocument.update({ where: { documentId: input.doc.documentId }, data: { status: "Make Error" } });
    await logShmEvent(input.doc.documentId, "make_webhook_missing", request);
    await afterPmaFinalUploadFailure(input.doc.documentId, input.doc.documentType, request);
    return { ok: false, status: 500, message: "MAKE_WEBHOOK_URL is not configured." };
  }

  const attachments = normalizedAttachments(input.attachments);
  const builtPayload = buildMakePayload({ ...input, attachments });
  const needsSlimPayload = payloadByteSize(builtPayload) > MAKE_WEBHOOK_BYTE_LIMIT;
  const combinedPayload = needsSlimPayload ? slimMakePayload(builtPayload) : builtPayload;
  if (needsSlimPayload) {
    await logShmEvent(input.doc.documentId, "make_payload_slimmed", request);
  }
  const forceSplitAttachments = isSelfServiceDocxFormDocumentType(input.doc.documentType) && attachments.length > 0;
  const shouldSplit = payloadByteSize(combinedPayload) > MAKE_WEBHOOK_BYTE_LIMIT || forceSplitAttachments;

  if (!shouldSplit) {
    const result = await postMakeWebhook(webhookUrl, combinedPayload);
    if (!result.ok) {
      await prisma.shmDocument.update({ where: { documentId: input.doc.documentId }, data: { status: "Make Error" } });
      await logShmEvent(input.doc.documentId, `make_error_${result.status}`, request);
      await afterPmaFinalUploadFailure(input.doc.documentId, input.doc.documentType, request);
      return { ok: false, status: 502, message: result.message, details: result.details };
    }

    await logShmEvent(input.doc.documentId, "final_payload_sent_to_make", request);
    return { ok: true, status: 200, message: "Payload sent to Make." };
  }

  const mainPayload = preparePayloadForMakeWebhook(buildMakePayload({
    ...input,
    attachments,
    options: {
      isMainDocument: true,
      isSupportingAttachment: false,
      mainDocumentFileName: input.fileName,
      includeAttachments: false,
    },
  }));

  if (payloadByteSize(mainPayload) > MAKE_WEBHOOK_BYTE_LIMIT) {
    await prisma.shmDocument.update({ where: { documentId: input.doc.documentId }, data: { status: "Make Error" } });
    await logShmEvent(input.doc.documentId, "make_error_413_main_payload_too_large", request);
    await afterPmaFinalUploadFailure(input.doc.documentId, input.doc.documentType, request);
    return {
      ok: false,
      status: 413,
      message: "Document is too large for Make.com (max ~3 MB after encoding). Please reduce attached file sizes and try again.",
      details: "",
    };
  }

  const mainResult = await postMakeWebhook(webhookUrl, mainPayload);
  if (!mainResult.ok) {
    await prisma.shmDocument.update({ where: { documentId: input.doc.documentId }, data: { status: "Make Error" } });
    await logShmEvent(input.doc.documentId, `make_error_${mainResult.status}`, request);
    await afterPmaFinalUploadFailure(input.doc.documentId, input.doc.documentType, request);
    return { ok: false, status: 502, message: mainResult.message, details: mainResult.details };
  }

  await logShmEvent(input.doc.documentId, "main_payload_sent_to_make", request);

  for (const attachment of attachments) {
    const attachmentResult = await sendSupportingAttachmentToMake(
      {
        doc: input.doc,
        token: input.token,
        mainFileName: input.fileName,
        attachment,
        recipient: input.recipient,
        signerName: input.signerName,
        driveFolderName: input.driveFolderName,
      },
      request,
    );
    if (!attachmentResult.ok) {
      await prisma.shmDocument.update({ where: { documentId: input.doc.documentId }, data: { status: "Make Error" } });
      await afterPmaFinalUploadFailure(input.doc.documentId, input.doc.documentType, request);
      return { ok: false, status: 502, message: attachmentResult.message, details: attachmentResult.details };
    }
  }

  await logShmEvent(input.doc.documentId, "final_payload_sent_to_make", request);
  return { ok: true, status: 200, message: "Payload sent to Make." };
}

async function afterPmaFinalUploadFailure(documentId: string, documentType: string, request: Request) {
  try {
    const { isPropertyManagementAgreement, isTenantAgreement } = await import("./documents");
    if (isPropertyManagementAgreement(documentType)) {
      const { attemptPmaEmailRecoveryOnUploadFailure } = await import("./pma-final-delivery-emails");
      await attemptPmaEmailRecoveryOnUploadFailure(documentId, request);
    }
    if (isTenantAgreement(documentType)) {
      const { attemptTenantAgreementEmailRecoveryOnUploadFailure } = await import("./ta-final-delivery-emails");
      await attemptTenantAgreementEmailRecoveryOnUploadFailure(documentId, request);
    }
  } catch (error) {
    console.error("[sendPayloadToMake] final email recovery after upload failure", error);
  }
}

async function afterPmaDirectDriveSuccess(
  documentId: string,
  documentType: string,
  fileUrl: string | undefined,
  request: Request,
) {
  try {
    const { isPropertyManagementAgreement, isTenantAgreement } = await import("./documents");
    if (isPropertyManagementAgreement(documentType)) {
      const { deliverPmaFinalSignedEmailsIfNeeded } = await import("./pma-final-delivery-emails");
      await deliverPmaFinalSignedEmailsIfNeeded(documentId, fileUrl, request);
    }
    if (isTenantAgreement(documentType)) {
      const { deliverTenantAgreementFinalSignedEmailsIfNeeded } = await import("./ta-final-delivery-emails");
      await deliverTenantAgreementFinalSignedEmailsIfNeeded(documentId, fileUrl, request);
    }
  } catch (error) {
    console.error("[sendPayloadToMake] final delivery emails after direct Drive", error);
  }
}
