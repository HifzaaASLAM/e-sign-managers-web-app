import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  isPmTakeoverForm,
  logShmEvent,
  rollupDocumentStatus,
  validateShmSignerToken,
} from "../../../../../lib/shm/documents";
import { revokeSignerAccess } from "../../../../../lib/shm/signing-access";
import {
  MAKE_ATTACHMENT_RAW_BYTE_LIMIT,
  buildPmTakeoverDriveFolderName,
  normalizeFileType,
  normalizeMakeDriveFileName,
  sendPayloadToMake,
  sendSupportingAttachmentToMake,
  stripDataUri,
} from "../../../../../lib/shm/make";
import {
  ensureDriveFolder,
  getDriveParentFolderId,
  isDriveDirectUploadConfigured,
  uploadFileToDriveFolder,
} from "../../../../../lib/shm/google-drive";
import { sendAdminFinalFileReadyEmail, sendAdminRecipientSignedEmail } from "../../../../../lib/shm/mailer";
import { generatePmTakeoverDocx } from "../../../../../lib/shm/pm-takeover-docx";
import { scheduleBackgroundWork } from "../../../../../lib/shm/background-jobs";
import { claimSignerSigned } from "../../../../../lib/shm/signing-claim";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ATTACHMENT_FILES = 18;
/** Per-file cap for direct Google Drive uploads (no Make webhook JSON overhead). */
const DIRECT_UPLOAD_FILE_BYTE_LIMIT = 25 * 1024 * 1024;

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
}

function parseAgreementData(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isValidDocxBuffer(buffer: Buffer) {
  return buffer.length > 3000 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

const ALLOWED_ATTACHMENT_EXTENSIONS = /\.(pdf|docx?|jpe?g|png|gif|webp|heic|heif|xlsx?|csv|txt)$/i;
const ATTACHMENT_SLOT_PREFIXES = ["keys", "condition", "other"] as const;

function sanitizeAttachmentBaseName(name: string) {
  return String(name || "file").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "file";
}

function ensureAttachmentDriveName(fileName: string) {
  const base = sanitizeAttachmentBaseName(fileName);
  const lower = base.toLowerCase();
  if (ATTACHMENT_SLOT_PREFIXES.some((slot) => lower.startsWith(`${slot}__`))) {
    return base;
  }
  return `other__${base}`;
}

function collectAttachmentFilesFromForm(formData: FormData) {
  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File) || !value.size) continue;
    if (
      key === "attachments"
      || key === "attachment"
      || /^attachment_\d+$/.test(key)
      || /^attachment_(keys|condition|other)_\d+$/.test(key)
    ) {
      const driveName = ensureAttachmentDriveName(value.name);
      files.push(driveName === value.name ? value : new File([value], driveName, { type: value.type, lastModified: value.lastModified }));
    }
  }
  return files.slice(0, MAX_ATTACHMENT_FILES);
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ message: "Invalid form submission." }, { status: 400 });
  }

  const docId = String(formData.get("doc_id") || "").trim();
  const token = String(formData.get("token") || "").trim();
  const signature = String(formData.get("signature") || "").trim();
  const agreementDataRaw = String(formData.get("agreement_data") || "{}");
  const fieldValues = parseAgreementData(agreementDataRaw);
  const attachmentFiles = collectAttachmentFilesFromForm(formData);
  const attachmentNames = attachmentFiles.length
    ? attachmentFiles.map((file) => file.name)
    : Array.isArray(fieldValues.attachment_names)
      ? fieldValues.attachment_names.map((name) => String(name))
      : [];
  const attachmentCount = attachmentFiles.length || Number(fieldValues.attachment_count || attachmentNames.length || 0);

  if (!docId || !token) {
    return NextResponse.json({ message: "Missing doc_id or token" }, { status: 400 });
  }
  if (!signature) {
    return NextResponse.json({ message: "Missing signature" }, { status: 400 });
  }

  const directUpload = isDriveDirectUploadConfigured();
  const perFileLimit = directUpload ? DIRECT_UPLOAD_FILE_BYTE_LIMIT : MAKE_ATTACHMENT_RAW_BYTE_LIMIT;
  const perFileLimitLabel = directUpload ? "25 MB" : "3 MB";
  for (const file of attachmentFiles) {
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.test(file.name || "")) {
      return NextResponse.json({
        message: `${file.name} is not an allowed file type. Please upload PDF, Word, Excel, CSV, text, or image files (JPG/PNG/HEIC/WebP).`,
      }, { status: 400 });
    }
    if (file.size > perFileLimit) {
      return NextResponse.json({
        message: `${file.name} is too large (max ${perFileLimitLabel} per file). Please upload a smaller file.`,
      }, { status: 413 });
    }
  }

  const validation = await validateShmSignerToken(docId, token);
  if (!validation?.document) {
    return NextResponse.json({ message: "Invalid document or token" }, { status: 403 });
  }

  const { document: doc } = validation;
  if (!isPmTakeoverForm(doc.documentType)) {
    return NextResponse.json({ message: "This endpoint is only for PM Takeover Form documents." }, { status: 400 });
  }

  const signerNameForFile = String(fieldValues.signer_name || validation.signer?.name || doc.recipientName || "Signer").trim();
  const signDateForFile = String(fieldValues.sign_date || new Date().toISOString().slice(0, 10)).trim();
  let docxBuffer: Buffer;
  try {
    docxBuffer = await generatePmTakeoverDocx(fieldValues, { signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate PM Takeover Form document.";
    return NextResponse.json({ message }, { status: 500 });
  }
  if (!isValidDocxBuffer(docxBuffer)) {
    return NextResponse.json({ message: "Generated takeover document was invalid. Please try again." }, { status: 500 });
  }

  const fileContent = docxBuffer.toString("base64");
  const fileName = normalizeMakeDriveFileName(
    `PM-Takeover-Form-${signerNameForFile}-${signDateForFile}.docx`,
    "docx",
  );
  const fileType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  let signer = validation.signer;
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || null;
  const userAgent = request.headers.get("user-agent") || null;

  if (!signer) {
    const signerType = doc.adminToken === token ? "creator" : "recipient";
    signer = await prisma.shmDocumentSigner.create({
      data: {
        id: `${doc.documentId}-${signerType}-${Date.now()}`,
        documentId: doc.documentId,
        name: signerType === "creator" ? doc.adminName || "Creator" : doc.recipientName,
        email: signerType === "creator" ? doc.adminEmail || "" : doc.recipientEmail,
        role: signerType === "creator" ? "Creator" : doc.recipientRole,
        signerType,
        token,
        signingUrl: doc.signingUrl,
        status: "Viewed",
        viewedAt: new Date(),
      },
    });
  }

  if (signer.status === "Signed") {
    return NextResponse.json({
      message: "You have already signed this document. This link can no longer be used.",
    }, { status: 409 });
  }

  const claimed = await claimSignerSigned({
    signerId: signer.id,
    signature,
    ipAddress,
    userAgent,
  });
  if (!claimed) {
    return NextResponse.json({
      message: "You have already signed this document. This link can no longer be used.",
    }, { status: 409 });
  }

  const signerType = signer.signerType as "creator" | "recipient";
  const updatedSigners = await prisma.shmDocumentSigner.findMany({ where: { documentId: doc.documentId } });
  const nextStatus = rollupDocumentStatus(updatedSigners, undefined, doc.documentType);
  const signedField = {
    tenantSignature: signature,
    tenantSignedAt: new Date(),
    signedAt: new Date(),
  };
  const agreementData = mergeAgreementData(doc.agreementData, {
    field_values: fieldValues,
    last_submission: {
      signerType: signer.signerType,
      signerName: signer.name,
      signerEmail: signer.email,
      fileName,
      fileType,
      fileBytes: stripDataUri(fileContent).length,
      attachments: attachmentNames.map((name) => ({ fileName: name })),
      attachmentCount,
      drive_folder_name: buildPmTakeoverDriveFolderName(String(fieldValues.signer_name || signer.name || "")),
      signedAt: new Date().toISOString(),
    },
  });

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: { status: nextStatus, agreementData, ...signedField },
  });
  await logShmEvent(doc.documentId, `${signerType}_signed`, request);

  await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Processing" } });
  await logShmEvent(doc.documentId, "pm_takeover_signed_ready_for_drive", request);

  const signerName = String(fieldValues.signer_name || signer.name || doc.recipientName || "").trim();
  const driveFolderName = buildPmTakeoverDriveFolderName(signerName);

  // Buffer attachments in memory before returning so background work does not need the request body.
  const attachmentBuffers: Array<{ name: string; type: string; buffer: Buffer }> = [];
  for (const file of attachmentFiles) {
    attachmentBuffers.push({
      name: file.name,
      type: normalizeFileType(file.type, file.name),
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  }

  scheduleBackgroundWork((async () => {
    if (signerType === "recipient" && doc.adminEmail) {
      const adminEmailResult = await sendAdminRecipientSignedEmail({
        to: doc.adminEmail,
        adminName: doc.adminName,
        documentId: doc.documentId,
        documentType: doc.documentType,
        propertyAddress: doc.propertyAddress,
        signerName: signer.name,
        signerEmail: signer.email,
      });
      await logShmEvent(
        doc.documentId,
        adminEmailResult.ok ? "admin_recipient_signed_email_sent" : adminEmailResult.skipped ? "admin_recipient_signed_email_skipped" : "admin_recipient_signed_email_error",
        request,
      );
    }

    let fellBackToMake = !directUpload;
    if (directUpload) {
      try {
        const folder = await ensureDriveFolder(driveFolderName, getDriveParentFolderId() || undefined);
        const mainFile = await uploadFileToDriveFolder({
          name: fileName,
          mimeType: fileType,
          buffer: docxBuffer,
          folderId: folder.id,
        });

        const uploadedAttachments: Array<{ fileName: string; fileId: string; fileUrl: string }> = [];
        for (const file of attachmentBuffers) {
          const uploaded = await uploadFileToDriveFolder({
            name: file.name,
            mimeType: file.type,
            buffer: file.buffer,
            folderId: folder.id,
          });
          uploadedAttachments.push({ fileName: file.name, fileId: uploaded.id, fileUrl: uploaded.url });
        }

        await prisma.shmDocument.update({
          where: { documentId: doc.documentId },
          data: {
            status: "Signed",
            signedDriveUrl: folder.url,
            signedAt: new Date(),
            agreementData: mergeAgreementData(agreementData, {
              drive_folder_id: folder.id,
              drive_folder_url: folder.url,
              main_file_id: mainFile.id,
              main_file_url: mainFile.url,
              uploaded_attachments: uploadedAttachments,
              last_drive_upload_at: new Date().toISOString(),
            }),
          },
        });
        await logShmEvent(doc.documentId, "drive_file_saved", request);
        await logShmEvent(doc.documentId, "signed_complete", request);

        if (doc.adminEmail) {
          const adminEmailResult = await sendAdminFinalFileReadyEmail({
            to: doc.adminEmail,
            adminName: doc.adminName,
            documentId: doc.documentId,
            documentType: doc.documentType,
            propertyAddress: doc.propertyAddress,
            signerName: signer.name,
            signerEmail: signer.email,
            fileUrl: folder.url,
          });
          await logShmEvent(doc.documentId, adminEmailResult.ok ? "admin_final_file_ready_email_sent" : adminEmailResult.skipped ? "admin_final_file_ready_email_skipped" : "admin_final_file_ready_email_error", request);
        }

        await revokeSignerAccess(doc.documentId, signerType);
        await logShmEvent(doc.documentId, `${signerType}_link_revoked`, request);
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[pm-takeover/submit] direct Drive upload failed:", detail);
        await logShmEvent(doc.documentId, "pm_takeover_direct_drive_error", request);

        const filesFitMakeLimit = docxBuffer.length <= MAKE_ATTACHMENT_RAW_BYTE_LIMIT
          && attachmentBuffers.every((file) => file.buffer.length <= MAKE_ATTACHMENT_RAW_BYTE_LIMIT);
        if (!filesFitMakeLimit) {
          await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Make Error" } });
          return;
        }
        fellBackToMake = true;
      }
    }

    if (fellBackToMake) {
      await logShmEvent(doc.documentId, "pm_takeover_drive_fallback_to_make", request);
    }

    const result = await sendPayloadToMake({
      doc,
      token,
      fileName,
      fileContent: stripDataUri(fileContent),
      fileType,
      recipient: { name: signer.name, email: signer.email },
      signerName,
      driveFolderName,
      attachments: [],
    }, request);

    if (!result.ok) {
      await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Make Error" } });
      await logShmEvent(doc.documentId, `pm_takeover_make_upload_failed_${result.status || "unknown"}`, request);
      return;
    }

    for (const file of attachmentBuffers) {
      const attachmentResult = await sendSupportingAttachmentToMake({
        doc,
        token,
        mainFileName: fileName,
        attachment: {
          fileName: file.name,
          fileType: file.type,
          fileContent: file.buffer.toString("base64"),
        },
        recipient: { name: signer.name, email: signer.email },
        signerName,
        driveFolderName,
      }, request);
      if (!attachmentResult.ok) {
        await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Make Error" } });
        await logShmEvent(doc.documentId, "pm_takeover_attachment_make_failed", request);
        return;
      }
    }

    await revokeSignerAccess(doc.documentId, signerType);
    await logShmEvent(doc.documentId, `${signerType}_link_revoked`, request);
  })());

  return NextResponse.json({
    success: true,
    accepted: true,
    message: "PM Takeover Form submitted successfully. Upload is processing in the background.",
    status: "Processing",
    fileName,
    fileType,
    drive_folder_name: driveFolderName,
    attachments_uploaded: attachmentFiles.length,
    driveQueued: true,
  }, { status: 202 });
}
