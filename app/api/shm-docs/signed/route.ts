import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  isTenantAgreement,
  isTenantApplication,
  logShmEvent,
  validateShmSignerToken,
  rollupDocumentStatus,
} from "../../../../lib/shm/documents";
import { revokeSignerAccess } from "../../../../lib/shm/signing-access";
import { sendPayloadToMake, stripDataUri, normalizeFileType } from "../../../../lib/shm/make";
import { scheduleBackgroundWork } from "../../../../lib/shm/background-jobs";
import { claimSignerSigned, stripHeavyAgreementBlobs } from "../../../../lib/shm/signing-claim";
import {
  isMultiTenantAgreementData,
  mergeTenantSignaturesIntoAgreement,
  shouldBuildSharedTenantAgreementFile,
} from "../../../../lib/shm/multi-tenant-signatures";
import { regenerateMultiTenantCombinedFile } from "../../../../lib/shm/regenerate-multi-tenant-file";
import { deliverFinalDocumentDirectToDrive } from "../../../../lib/shm/drive-delivery";
import { scheduleTenantApplicationAutoApprove } from "../../../../lib/shm/tenant-application-auto-approve";

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try { existing = existingRaw ? JSON.parse(existingRaw) : {}; } catch { existing = {}; }
  return JSON.stringify(stripHeavyAgreementBlobs({ ...existing, ...patch }));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "").trim();
  const token = String(body?.token || "").trim();
  const fileName = String(body?.fileName || body?.file_name || "signed-document.pdf").trim();
  const fileContent = String(body?.fileContent || body?.file_content || body?.signature || "").trim();
  const fileType = normalizeFileType(String(body?.fileType || body?.file_type || ""), fileName);
  const signature = String(body?.signature || body?.tenant_signature || body?.owner_signature || body?.recipient_signature || "").trim();
  const fieldValues = body?.field_values || body?.agreement_data || body?.agreementData || {};

  if (!docId || !token) return NextResponse.json({ message: "Missing doc_id or token" }, { status: 400 });
  if (!signature && !fileContent) return NextResponse.json({ message: "Missing signature or generated file content" }, { status: 400 });

  const validation = await validateShmSignerToken(docId, token);
  if (!validation?.document) return NextResponse.json({ message: "Invalid document or token" }, { status: 403 });
  const { document: doc } = validation;
  let signer = validation.signer;
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || null;
  const userAgent = request.headers.get("user-agent") || null;

  if (!signer) {
    const signerType = doc.adminToken === token ? "creator" : "recipient";
    try {
      signer = await prisma.shmDocumentSigner.create({
        data: {
          id: `${doc.documentId}-${signerType}`,
          documentId: doc.documentId,
          name: signerType === "creator" ? doc.adminName || "Creator" : doc.recipientName,
          email: signerType === "creator" ? doc.adminEmail || "" : doc.recipientEmail,
          role: signerType === "creator" ? "Creator" : doc.recipientRole,
          signerType,
          token,
          signingUrl: signerType === "creator" && doc.adminToken ? `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL}/sign-document?doc_id=${doc.documentId}&token=${doc.adminToken}&role=creator` : doc.signingUrl,
          status: "Viewed",
          viewedAt: new Date(),
        },
      });
    } catch {
      // Concurrent create — reload by token
      signer = await prisma.shmDocumentSigner.findFirst({
        where: { documentId: doc.documentId, token },
      });
      if (!signer) {
        return NextResponse.json({ message: "Could not create signer record. Please try again." }, { status: 409 });
      }
    }
  }

  if (signer.status === "Signed") {
    return NextResponse.json({ message: "You have already signed this document. This link can no longer be used." }, { status: 409 });
  }

  const claimed = await claimSignerSigned({
    signerId: signer.id,
    signature,
    ipAddress,
    userAgent,
  });
  if (!claimed) {
    return NextResponse.json({ message: "You have already signed this document. This link can no longer be used." }, { status: 409 });
  }

  const signerType = signer.signerType as "creator" | "recipient";
  const recipientCount = doc.signers.filter((item) => item.signerType === "recipient" && item.status !== "Removed").length;
  const multiTenantRecipients = recipientCount > 1;
  await revokeSignerAccess(doc.documentId, signerType, signer.id);
  await logShmEvent(doc.documentId, `${signerType}_link_revoked`, request);

  const updatedSigners = await prisma.shmDocumentSigner.findMany({ where: { documentId: doc.documentId } });
  const nextStatus = rollupDocumentStatus(updatedSigners, undefined, doc.documentType);
  const activeRecipients = updatedSigners.filter(
    (item) => item.signerType === "recipient" && item.status !== "Removed",
  );
  const allRecipientsSigned =
    activeRecipients.length > 0 && activeRecipients.every((item) => item.status === "Signed");
  const signedField =
    signerType === "creator"
      ? { adminSignature: signature, adminSignedAt: new Date() }
      : multiTenantRecipients
        ? allRecipientsSigned
          ? { tenantSignature: signature, tenantSignedAt: new Date(), signedAt: new Date() }
          : {}
        : { tenantSignature: signature, tenantSignedAt: new Date(), signedAt: new Date() };
  let combinedArtifact: { fileContent: string; fileName: string; fileType: string } | null = null;
  let agreementParsed: Record<string, unknown> = {};
  try {
    agreementParsed = doc.agreementData ? JSON.parse(doc.agreementData) : {};
  } catch {
    agreementParsed = {};
  }
  const sharedTenantFile = shouldBuildSharedTenantAgreementFile(agreementParsed, recipientCount);
  if (sharedTenantFile && (signerType === "recipient" || signerType === "creator")) {
    const combined = await regenerateMultiTenantCombinedFile(doc.documentId);
    if (combined) {
      combinedArtifact = {
        fileContent: combined.fileContent,
        fileName: combined.fileName,
        fileType: combined.fileType,
      };
    }
  }

  const embeddedFileContent = combinedArtifact?.fileContent || fileContent;
  const embeddedFileName = combinedArtifact?.fileName || fileName;
  const embeddedFileType = combinedArtifact?.fileType || fileType;

  const strippedFileContent = stripDataUri(embeddedFileContent);
  let agreementData = mergeAgreementData(doc.agreementData, {
    field_values: fieldValues,
    last_submission: {
      signerType: signer.signerType,
      signerName: signer.name,
      signerEmail: signer.email,
      fileName: embeddedFileName,
      fileType: embeddedFileType,
      fileContent: strippedFileContent,
      fileBytes: strippedFileContent.length,
      signedAt: new Date().toISOString(),
    },
    ...(isTenantApplication(doc.documentType || "") &&
    signerType === "recipient" &&
    strippedFileContent &&
    !strippedFileContent.startsWith("[omitted")
      ? {
          applicant_signed_docx: {
            fileName: embeddedFileName,
            fileType: embeddedFileType,
            fileContent: strippedFileContent,
          },
        }
      : {}),
  });
  agreementData = mergeTenantSignaturesIntoAgreement(agreementData, updatedSigners);

  if (combinedArtifact) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(agreementData);
    } catch {
      parsed = {};
    }
    agreementData = JSON.stringify({
      ...parsed,
      multi_tenant_combined_b64: combinedArtifact.fileContent,
      multi_tenant_combined_mime: combinedArtifact.fileType,
      multi_tenant_combined_updated_at: new Date().toISOString(),
    });
  }

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: { status: nextStatus, agreementData, ...signedField },
  });
  await logShmEvent(doc.documentId, `${signerType}_signed`, request);

  const creatorSigned =
    updatedSigners.some((item) => item.signerType === "creator" && item.status === "Signed")
    || Boolean(doc.adminSignedAt)
    || signerType === "creator";
  const recipientSigned = multiTenantRecipients
    ? allRecipientsSigned
    : updatedSigners.some((item) => item.signerType === "recipient" && item.status === "Signed")
      || Boolean(doc.tenantSignedAt)
      || signerType === "recipient";
  const allSigned = isTenantAgreement(doc.documentType)
    ? allRecipientsSigned
    : creatorSigned && recipientSigned;

  if (signerType === "recipient" && isTenantApplication(doc.documentType || "") && !creatorSigned) {
    await scheduleTenantApplicationAutoApprove(doc.documentId, request);
  }

  if (signerType === "recipient" && isTenantAgreement(doc.documentType)) {
    const payloadFileContent = stripDataUri(embeddedFileContent);
    if (!multiTenantRecipients || allRecipientsSigned) {
      scheduleBackgroundWork(
        import("../../../../lib/shm/tenant-agreement-post-tenant-sign").then(({ runTenantAgreementPostTenantSignWorkflow }) =>
          runTenantAgreementPostTenantSignWorkflow({
            documentId: doc.documentId,
            fileName: embeddedFileName,
            fileContent: payloadFileContent,
            fileType: embeddedFileType,
            token,
            request,
          }),
        ),
      );
    }
  }

  if (sharedTenantFile && combinedArtifact && isTenantAgreement(doc.documentType)) {
    const incrementalPayload = stripDataUri(combinedArtifact.fileContent);
    scheduleBackgroundWork(
      deliverFinalDocumentDirectToDrive(
        {
          doc: {
            documentId: doc.documentId,
            documentType: doc.documentType,
            recipientName: doc.recipientName,
            recipientEmail: doc.recipientEmail,
            adminName: doc.adminName,
            adminEmail: doc.adminEmail,
            propertyAddress: doc.propertyAddress,
          },
          fileName: combinedArtifact.fileName,
          fileContent: incrementalPayload,
          fileType: combinedArtifact.fileType,
          recipient: { name: signer.name, email: signer.email },
          signerName: signer.name,
          driveFolderName: `${doc.documentId} - ${doc.documentType} - Shared Agreement`,
        },
        request,
      ).then(async (result) => {
        if (!result.ok) {
          await logShmEvent(doc.documentId, `multi_tenant_incremental_drive_failed_${result.status || "unknown"}`, request);
        } else {
          await logShmEvent(doc.documentId, "multi_tenant_incremental_drive_saved", request);
        }
      }),
    );
  }

  if (!allSigned) {
    const waitingMessage = isTenantAgreement(doc.documentType)
      ? multiTenantRecipients
        ? "Your signature was saved. Waiting for other tenants or the rental provider to sign."
        : "Your signature was saved. Waiting for the other signing party."
      : multiTenantRecipients
        ? signerType === "creator"
          ? "Creator signed. Waiting for all tenants to sign."
          : "Your signature was saved on the shared agreement. Waiting for other tenants or the creator."
        : signerType === "creator"
          ? "Creator signed. Waiting for recipient signature."
          : "Recipient signed. Waiting for creator signature.";
    return NextResponse.json({
      success: true,
      message: waitingMessage,
      status: nextStatus,
      fileName: combinedArtifact?.fileName || fileName,
      fileType: combinedArtifact?.fileType || fileType,
      linkRevoked: true,
      driveQueued: false,
      multiTenantCombined: Boolean(combinedArtifact),
    });
  }

  await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Processing" } });
  await logShmEvent(doc.documentId, "both_parties_signed", request);

  const freshDoc = await prisma.shmDocument.findUnique({
    where: { documentId: doc.documentId },
    select: { agreementData: true },
  });
  let storedCombined = "";
  try {
    const parsed = freshDoc?.agreementData ? JSON.parse(freshDoc.agreementData) : {};
    storedCombined = String(parsed.multi_tenant_combined_b64 || "");
  } catch {
    storedCombined = "";
  }
  if (multiTenantRecipients && !storedCombined) {
    const combined = await regenerateMultiTenantCombinedFile(doc.documentId);
    if (combined) storedCombined = combined.fileContent;
  }
  const payloadFileContent = stripDataUri(storedCombined || fileContent);
  const finalFileName = multiTenantRecipients && storedCombined
    ? `Tenant-Agreement-${doc.documentId}-fully-signed.${fileName.split(".").pop() || "pdf"}`
    : fileName;
  const finalFileType = multiTenantRecipients && storedCombined
    ? String(
        (() => {
          try {
            const p = freshDoc?.agreementData ? JSON.parse(freshDoc.agreementData) : {};
            return p.multi_tenant_combined_mime || fileType;
          } catch {
            return fileType;
          }
        })(),
      )
    : fileType;
  const recipient = { name: signer.name, email: signer.email };

  // Do not block the signer on Drive/Make (can take up to 120s). Process in background.
  scheduleBackgroundWork((async () => {
    const result = await sendPayloadToMake({
      doc: {
        documentType: doc.documentType,
        documentId: doc.documentId,
        recipientName: doc.recipientName,
        recipientEmail: doc.recipientEmail,
      },
      token,
      fileName: finalFileName,
      fileContent: payloadFileContent,
      fileType: finalFileType,
      recipient,
    }, request);

    if (!result.ok) {
      await prisma.shmDocument.update({ where: { documentId: doc.documentId }, data: { status: "Make Error" } });
      await logShmEvent(doc.documentId, `signed_make_upload_failed_${result.status || "unknown"}`, request);
      return;
    }
    await logShmEvent(doc.documentId, "signed_complete", request);
  })());

  return NextResponse.json({
    success: true,
    accepted: true,
    message: "Both parties have signed. Document submitted for final processing.",
    status: "Processing",
    fileName: finalFileName,
    fileType: finalFileType,
    driveQueued: true,
    delivery: "queued",
  }, { status: 202 });
}
