import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  isOnePartySignedDocumentType,
  isPropertyManagementAgreement,
  isTenantAgreement,
  logShmEvent,
  tenantAgreementAllRecipientsSigned,
} from "../../../../lib/shm/documents";
import { sendAdminFinalFileReadyEmail } from "../../../../lib/shm/mailer";
import { deliverPmaFinalSignedEmailsIfNeeded } from "../../../../lib/shm/pma-final-delivery-emails";
import { deliverTenantAgreementFinalSignedEmailsIfNeeded } from "../../../../lib/shm/ta-final-delivery-emails";

export const dynamic = "force-dynamic";

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
}

/**
 * Make.com calls this after Google Drive upload succeeds.
 * Expected JSON body:
 * { doc_id, signed_drive_url, file_id?, secret_key, folder_url? }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || body?.documentId || "").trim();
  const signedDriveUrl = String(
    body?.signed_drive_url || body?.signedDriveUrl || body?.folder_url || body?.webViewLink || body?.file_url || "",
  ).trim();
  const fileId = String(body?.file_id || body?.fileId || body?.id || "").trim();
  const secretKey = String(body?.secret_key || body?.secretKey || "").trim();
  const expectedSecret = String(process.env.MAKE_CALLBACK_SECRET || "").trim();

  if (!docId) {
    return NextResponse.json({ message: "Missing doc_id" }, { status: 400 });
  }
  if (!signedDriveUrl) {
    return NextResponse.json({ message: "Missing signed_drive_url" }, { status: 400 });
  }
  if (expectedSecret && secretKey !== expectedSecret) {
    return NextResponse.json({ message: "Invalid secret_key" }, { status: 403 });
  }

  const doc = await prisma.shmDocument.findUnique({
    where: { documentId: docId },
    include: { signers: true },
  });
  if (!doc) {
    return NextResponse.json({ message: "Document not found" }, { status: 404 });
  }

  await logShmEvent(doc.documentId, "drive_callback_received", request);

  const oneParty = isOnePartySignedDocumentType(doc.documentType);
  const recipientSigned =
    doc.signers.some((signer) => signer.signerType === "recipient" && signer.status === "Signed")
    || Boolean(doc.tenantSignedAt || doc.signedAt);
  const creatorSigned =
    doc.signers.some((signer) => signer.signerType === "creator" && signer.status === "Signed")
    || Boolean(doc.adminSignedAt);
  const allRecipientsSigned = tenantAgreementAllRecipientsSigned(doc.signers);
  const complete = oneParty
    ? recipientSigned
    : isTenantAgreement(doc.documentType)
      ? allRecipientsSigned
      : recipientSigned && creatorSigned;

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: {
      status: complete ? "Signed" : doc.status === "Processing" ? "Processing" : doc.status,
      signedDriveUrl,
      signedAt: complete ? new Date() : doc.signedAt,
      agreementData: mergeAgreementData(doc.agreementData, {
        drive_callback_at: new Date().toISOString(),
        drive_file_id: fileId || undefined,
        signed_drive_url: signedDriveUrl,
        delivery_path: "make_callback",
      }),
    },
  });

  await logShmEvent(doc.documentId, complete ? "signed_complete" : "drive_file_saved", request);

  if (complete && doc.adminEmail) {
    const adminEmailResult = await sendAdminFinalFileReadyEmail({
      to: doc.adminEmail,
      adminName: doc.adminName,
      documentId: doc.documentId,
      documentType: doc.documentType,
      propertyAddress: doc.propertyAddress,
      signerName: doc.recipientName,
      signerEmail: doc.recipientEmail,
      fileUrl: signedDriveUrl,
    });
    await logShmEvent(
      doc.documentId,
      adminEmailResult.ok
        ? "admin_final_file_ready_email_sent"
        : adminEmailResult.skipped
          ? "admin_final_file_ready_email_skipped"
          : "admin_final_file_ready_email_error",
      request,
    );
  }

  if (complete && isPropertyManagementAgreement(doc.documentType)) {
    await deliverPmaFinalSignedEmailsIfNeeded(doc.documentId, signedDriveUrl, request);
  }

  if (complete && isTenantAgreement(doc.documentType)) {
    await deliverTenantAgreementFinalSignedEmailsIfNeeded(doc.documentId, signedDriveUrl, request);
  }

  return NextResponse.json({
    success: true,
    status: complete ? "Signed" : doc.status,
    signed_drive_url: signedDriveUrl,
  });
}
