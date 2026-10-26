import { prisma } from "../prisma";
import { logShmEvent } from "./documents";
import {
  buildTenantApplicationAuditLines,
  readLastSubmissionDocx,
  stampCreatorSignatureOnTenantApplicationDocx,
} from "./tenant-application-docx";
import { loadCreatorAutoSignatureDataUrl } from "./creator-auto-signature";

function parseAgreementData(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Stamp creator signature + audit trail onto the applicant DOCX and re-upload via Make.
 * Returns the regenerated last_submission payload, or null on failure.
 */
export async function regenerateTenantApplicationFinalDocx(input: {
  documentId: string;
  request?: Request;
  creatorName?: string;
  creatorEmail?: string;
  creatorSignatureDataUrl?: string;
  signedAt?: Date;
}) {
  const doc = await prisma.shmDocument.findUnique({ where: { documentId: input.documentId } });
  if (!doc) throw new Error("Document not found.");

  const agreementData = parseAgreementData(doc.agreementData);
  const existingDocx = readLastSubmissionDocx(agreementData);
  if (!existingDocx) {
    throw new Error("No applicant-signed DOCX found to stamp.");
  }

  const fieldValues =
    (agreementData.field_values as Record<string, unknown> | undefined) ||
    (agreementData.fieldValues as Record<string, unknown> | undefined) ||
    {};

  const applicantEmail = String(fieldValues.e_email || doc.recipientEmail || "").trim().toLowerCase();
  const applicantFirst = String(fieldValues.e_first || "").trim();
  const applicantLast = String(fieldValues.e_last || "").trim();
  const applicantName =
    [applicantFirst, applicantLast].filter(Boolean).join(" ") || doc.recipientName || "Applicant";

  const creatorName = input.creatorName || doc.adminName || "ShareHouse Managers";
  const creatorEmail = input.creatorEmail || doc.adminEmail || "";
  const signedAt = input.signedAt || doc.adminSignedAt || new Date();
  const creatorSignature =
    input.creatorSignatureDataUrl ||
    doc.adminSignature ||
    (await loadCreatorAutoSignatureDataUrl());

  const landlord =
    agreementData.landlord && typeof agreementData.landlord === "object"
      ? (agreementData.landlord as Record<string, unknown>)
      : null;

  const events = await prisma.shmDocumentEvent.findMany({
    where: { documentId: input.documentId },
    orderBy: { eventTime: "asc" },
    take: 40,
    select: { eventType: true, eventTime: true, ipAddress: true },
  });

  const auditLines = buildTenantApplicationAuditLines({
    documentId: doc.documentId,
    sentAt: doc.sentAt || doc.tenantSentAt,
    applicantName,
    applicantEmail,
    applicantSignedAt: doc.tenantSignedAt || doc.signedAt,
    creatorName,
    creatorEmail,
    creatorSignedAt: signedAt,
    landlordName: landlord ? String(landlord.name || "Landlord") : undefined,
    landlordEmail: landlord ? String(landlord.email || "") : undefined,
    landlordApprovedAt:
      landlord?.status === "approved"
        ? String(landlord.approvedAt || agreementData.landlord_approved_at || "") || undefined
        : undefined,
    events,
  });

  // Prefer stamping onto the original applicant DOCX (before any previous stamp),
  // so re-runs replace the approval block cleanly. The stamp function also removes prior stamps.
  const stamped = stampCreatorSignatureOnTenantApplicationDocx({
    docxBase64: existingDocx.fileContent,
    creatorSignatureDataUrl: creatorSignature,
    creatorName,
    creatorEmail,
    applicantName,
    applicantEmail,
    signedAt,
    documentId: doc.documentId,
    auditLines,
  });

  const stampedBase64 = stamped.toString("base64");
  const baseName = existingDocx.fileName.replace(/-Approved\.docx$/i, "").replace(/\.docx$/i, "");
  const stampedName = `${baseName}-Approved.docx`;

  const regeneratedSubmission = {
    fileName: stampedName,
    fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileContent: stampedBase64,
    signedAt: signedAt.toISOString(),
    signerType: "creator",
    signerName: creatorName,
    signerEmail: creatorEmail,
    creatorStamped: true,
    auditIncluded: true,
  };

  const { sendPayloadToMake } = await import("./make");
  const makeResult = await sendPayloadToMake(
    {
      doc: {
        documentId: doc.documentId,
        documentType: doc.documentType,
        recipientName: doc.recipientName,
        recipientEmail: doc.recipientEmail,
      },
      token: doc.token,
      fileName: stampedName,
      fileContent: stampedBase64,
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      recipient: { name: applicantName, email: applicantEmail || doc.recipientEmail },
      signerName: applicantName,
      driveFolderName: `Tenant Application - ${(applicantName || "Applicant").replace(/[\\/:*?"<>|]+/g, "").trim()}`,
      attachments: [],
    },
    input.request || new Request("http://localhost/internal"),
  );

  await logShmEvent(
    input.documentId,
    makeResult.ok
      ? "tenant_application_creator_stamped_docx_uploaded"
      : "tenant_application_creator_stamped_docx_upload_failed",
    input.request,
  );

  return { regeneratedSubmission, makeOk: makeResult.ok, applicantName, applicantEmail };
}
