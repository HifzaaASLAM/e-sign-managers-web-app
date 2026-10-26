import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  isPropertyManagementAgreement,
  logShmEvent,
  rollupDocumentStatus,
  validateShmSignerToken,
} from "../../../../../lib/shm/documents";
import { revokeSignerAccess } from "../../../../../lib/shm/signing-access";
import {
  MAKE_ATTACHMENT_RAW_BYTE_LIMIT,
  buildPropertyManagementAgreementDriveFolderName,
  isPdfBase64,
  normalizeFileType,
  normalizeMakeDriveFileName,
  selectPropertyManagementMakeUpload,
  sendPayloadToMake,
  stripDataUri,
} from "../../../../../lib/shm/make";
import { sendAdminRecipientSignedEmail } from "../../../../../lib/shm/mailer";
import { scheduleBackgroundWork } from "../../../../../lib/shm/background-jobs";
import { generatePropertyManagementAgreementBuiltDocx } from "../../../../../lib/shm/property-management-agreement-built-docx";
import {
  applyPmaClientOnlyFieldsFromStored,
  mergePmaFieldValues,
  normalizePmaAgreementStorage,
  parsePmaAgreementData,
} from "../../../../../lib/shm/property-management-agreement-fields";
import { schedulePmaAutoCreatorSign } from "../../../../../lib/shm/property-management-agreement-auto-creator-sign";
import { claimSignerSigned, stripHeavyAgreementBlobs } from "../../../../../lib/shm/signing-claim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
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

export async function POST(request: Request) {
  try {
    return await handlePropertyManagementAgreementSubmit(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Property Management Agreement submit failed.";
    console.error("[property-management-agreement/submit]", message, error);
    return NextResponse.json({ message }, { status: 500 });
  }
}

async function handlePropertyManagementAgreementSubmit(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "").trim();
  const token = String(body?.token || "").trim();
  const signature = String(body?.tenant_signature || body?.owner_signature || body?.signature || "").trim();
  const fileName = String(body?.fileName || body?.file_name || "Property-Management-Agreement.pdf").trim();
  const fileContent = stripDataUri(String(body?.fileContent || body?.file_content || ""));
  const docxContent = stripDataUri(String(body?.docxContent || body?.docx_content || ""));
  const fileType = normalizeFileType(String(body?.fileType || body?.file_type || "").trim(), fileName);
  const incomingAgreementData = parsePmaAgreementData(body?.agreement_data);

  if (!docId || !token) {
    return NextResponse.json({ message: "Missing doc_id or token" }, { status: 400 });
  }
  if (!signature) {
    return NextResponse.json({ message: "Missing signature" }, { status: 400 });
  }
  if (!fileContent && !docxContent) {
    return NextResponse.json({ message: "Missing generated file content" }, { status: 400 });
  }

  const validation = await validateShmSignerToken(docId, token);
  if (!validation?.document) {
    return NextResponse.json({ message: "Invalid document or token" }, { status: 403 });
  }

  const { document: doc } = validation;
  if (!isPropertyManagementAgreement(doc.documentType)) {
    return NextResponse.json({ message: "This endpoint is only for Property Management Agreement documents." }, { status: 400 });
  }

  const storedAgreementData = parsePmaAgreementData(doc.agreementData);
  const pendingSignerType =
    validation.signer?.signerType
    || (doc.adminToken === token ? "creator" : "recipient");
  let fieldValues = mergePmaFieldValues(storedAgreementData, incomingAgreementData);
  if (pendingSignerType === "recipient") {
    fieldValues = applyPmaClientOnlyFieldsFromStored(storedAgreementData, fieldValues);
  }

  const pdfBytes = decodeBase64ByteLength(fileContent);
  const fileContentIsPdf = fileContent ? isPdfBase64(fileContent) : false;
  const fileContentIsDocxType = fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || fileName.toLowerCase().endsWith(".docx");

  // PMA generation may return DOCX as the primary content when PDF rendering is unavailable.
  if (fileContent && !fileContentIsPdf && !docxContent && !fileContentIsDocxType) {
    return NextResponse.json({
      message: "Generated document is not a valid PDF/DOCX payload. Please try again.",
    }, { status: 400 });
  }
  if (fileContentIsPdf && pdfBytes > 0 && pdfBytes < 8000) {
    return NextResponse.json({
      message: "The generated PDF looks incomplete. Please try again.",
    }, { status: 400 });
  }

  const selectedUpload = selectPropertyManagementMakeUpload({
    pdfContent: fileContent,
    pdfType: fileType,
    pdfName: fileName,
    docxContent,
  });
  let uploadFileName = selectedUpload.fileName;
  let uploadFileContent = selectedUpload.fileContent;
  let uploadFileType = selectedUpload.fileType;

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

  const signedAt = new Date();
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
  const creatorSigned = updatedSigners.some(
    (s) => s.signerType === "creator" && s.status === "Signed",
  );
  const allRecipientsSigned = updatedSigners
    .filter((s) => s.signerType === "recipient" && s.status !== "Removed")
    .every((s) => s.status === "Signed");
  const readyForFinalDelivery = creatorSigned && allRecipientsSigned;
  const docPatch = signerType === "creator"
    ? { adminSignature: signature, adminSignedAt: signedAt }
    : { tenantSignature: signature, tenantSignedAt: signedAt, signedAt };

  const agreementPayload = stripHeavyAgreementBlobs(
    normalizePmaAgreementStorage({
      ...parsePmaAgreementData(doc.agreementData),
      ...fieldValues,
      field_values: fieldValues,
      last_submission: {
        signerType,
        signerName: signer.name,
        signerEmail: signer.email,
        fileName: uploadFileName,
        fileType: uploadFileType,
        signedAt: signedAt.toISOString(),
      },
    }),
  );
  const agreementData = JSON.stringify(agreementPayload);

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: { status: nextStatus, agreementData, ...docPatch },
  });
  await logShmEvent(doc.documentId, `${signerType}_signed`, request);

  if (signerType === "recipient" && !creatorSigned) {
    await schedulePmaAutoCreatorSign(doc.documentId, request);
  }

  if (signerType === "recipient" && doc.adminEmail) {
    scheduleBackgroundWork((async () => {
      const adminEmailResult = await sendAdminRecipientSignedEmail({
        to: doc.adminEmail!,
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
    })());
  }

  const signerName = String(
    fieldValues.owner_sign_name || fieldValues.owner || fieldValues.pma_owner || signer.name || doc.recipientName || "",
  ).trim();
  const driveFolderName = buildPropertyManagementAgreementDriveFolderName(signerName);

  const ownerSignature = signerType === "recipient"
    ? signature
    : String(doc.tenantSignature || signature).trim();
  const agentSignature = signerType === "creator"
    ? signature
    : String(doc.adminSignature || "").trim();

  try {
    const rebuilt = await generatePropertyManagementAgreementBuiltDocx({
      ...fieldValues,
      submittedAt: signedAt.toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }),
    }, { ownerSignature, agentSignature });
    uploadFileContent = rebuilt.toString("base64");
    uploadFileType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    uploadFileName = normalizeMakeDriveFileName(
      `Property-Management-Agreement-${signerName || "Owner"}-${signedAt.toISOString().slice(0, 10)}.docx`,
      "docx",
    );
    await logShmEvent(doc.documentId, "pma_docx_regenerated", request);
  } catch (error) {
    console.error("[property-management-agreement/submit] regenerate failed", error);
    await logShmEvent(doc.documentId, "pma_docx_regenerate_failed", request);
  }

  if (!readyForFinalDelivery) {
    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: { status: nextStatus },
    });
    await logShmEvent(doc.documentId, "pma_awaiting_counterparty_signature", request);

    return NextResponse.json({
      success: true,
      accepted: true,
      message:
        signerType === "recipient"
          ? "Owner signature saved. The agency will sign to complete the final document."
          : "Agency signature saved. Waiting for all required signatures before final file delivery.",
      status: nextStatus,
      fileName: uploadFileName,
      fileType: uploadFileType,
      drive_folder_name: driveFolderName,
    }, { status: 202 });
  }

  await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Processing" } });
  await logShmEvent(doc.documentId, "pma_signed_ready_for_drive", request);

  const uploadFileNameFinal = uploadFileName;
  const uploadFileContentFinal = uploadFileContent;
  const uploadFileTypeFinal = uploadFileType;

  scheduleBackgroundWork((async () => {
    const makeResult = await sendPayloadToMake({
      doc,
      token,
      fileName: uploadFileNameFinal,
      fileContent: uploadFileContentFinal,
      fileType: uploadFileTypeFinal,
      recipient: {
        name: String(body?.recipient?.name || signer.name || "").trim(),
        email: String(body?.recipient?.email || signer.email || "").trim(),
      },
      signerName,
      driveFolderName,
      attachments: [],
    }, request);

    if (!makeResult.ok) {
      const { attemptPmaEmailRecoveryOnUploadFailure } = await import(
        "../../../../../lib/shm/pma-final-delivery-emails"
      );
      const recovery = await attemptPmaEmailRecoveryOnUploadFailure(doc.documentId, request);
      if (!recovery.ok) {
        await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Make Error" } });
      }
      await logShmEvent(doc.documentId, `pma_make_upload_failed_${makeResult.status || "unknown"}`, request);
      if (recovery.ok) {
        await revokeSignerAccess(doc.documentId, "recipient");
        await revokeSignerAccess(doc.documentId, "creator");
        await logShmEvent(doc.documentId, "pma_links_revoked_after_final_delivery", request);
      }
      return;
    }

    await revokeSignerAccess(doc.documentId, "recipient");
    await revokeSignerAccess(doc.documentId, "creator");
    await logShmEvent(doc.documentId, "pma_links_revoked_after_final_delivery", request);
  })());

  return NextResponse.json({
    success: true,
    accepted: true,
    message: "Property Management Agreement completed. Final file upload is processing in the background.",
    status: "Processing",
    fileName: uploadFileName,
    fileType: uploadFileType,
    drive_folder_name: driveFolderName,
  }, { status: 202 });
}
