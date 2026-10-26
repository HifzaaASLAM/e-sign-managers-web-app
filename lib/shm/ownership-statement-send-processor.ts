import { prisma } from "../prisma";
import { scheduleBackgroundWork } from "./background-jobs";
import { logShmEvent } from "./documents";
import { sendPayloadToMake } from "./make";
import { sendOwnershipStatementToOwnerEmail } from "./mailer";
import { generateOwnershipStatementFile } from "./ownership-statement-export";
import { revokeSignerAccess } from "./signing-access";

export type OwnershipStatementSendJobStatus = "queued" | "processing" | "completed" | "failed";

export type OwnershipStatementSendJob = {
  id: string;
  status: OwnershipStatementSendJobStatus;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  emailSent?: boolean;
  driveUpload?: boolean;
  message?: string;
  error?: string;
};

type SendJobPayload = {
  ownerName: string;
  ownerEmail: string;
  adminSignature: string;
  adminSignatureDate: string;
  agreementData: Record<string, unknown>;
  adminName: string;
  adminEmail: string;
};

function parseAgreementData(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  return JSON.stringify({ ...parseAgreementData(existingRaw), ...patch });
}

function readSendJob(agreementData: Record<string, unknown>) {
  const job = agreementData.send_job;
  if (!job || typeof job !== "object") return null;
  return job as OwnershipStatementSendJob;
}

function readSendJobPayload(agreementData: Record<string, unknown>) {
  const payload = agreementData.send_job_payload;
  if (!payload || typeof payload !== "object") return null;
  return payload as SendJobPayload;
}

async function updateSendJob(
  documentId: string,
  existingRaw: string | null,
  patch: Partial<OwnershipStatementSendJob>,
  extraAgreementPatch?: Record<string, unknown>,
) {
  const existing = parseAgreementData(existingRaw);
  const currentJob = readSendJob(existing);
  if (!currentJob) return;

  const nextJob: OwnershipStatementSendJob = {
    ...currentJob,
    ...patch,
  };

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(existingRaw, {
        ...extraAgreementPatch,
        send_job: nextJob,
      }),
    },
  });
}

export async function claimOwnershipStatementSendJob(documentId: string, jobId: string) {
  const doc = await prisma.shmDocument.findUnique({ where: { documentId } });
  if (!doc) return null;

  const agreementData = parseAgreementData(doc.agreementData);
  const job = readSendJob(agreementData);
  const payload = readSendJobPayload(agreementData);

  if (!job || job.id !== jobId) return null;
  if (job.status !== "queued") return null;
  if (!payload) return null;

  const startedAt = new Date().toISOString();
  await updateSendJob(documentId, doc.agreementData, {
    status: "processing",
    startedAt,
    error: undefined,
    message: "Preparing the ownership statement and emailing the owner...",
  });

  return {
    doc,
    job: { ...job, status: "processing" as const, startedAt },
    payload,
  };
}

export async function processOwnershipStatementSendJob(documentId: string, jobId: string, request?: Request) {
  const claimed = await claimOwnershipStatementSendJob(documentId, jobId);
  if (!claimed) return { ok: false, status: 409, message: "This send request is no longer available. Please try again." };

  const { doc, payload } = claimed;
  const exportInput = {
    ...payload.agreementData,
    owner_name: payload.ownerName,
    owner_email: payload.ownerEmail,
    admin_signature_date: payload.adminSignatureDate,
    admin_signature: payload.adminSignature,
  };

  let generated;
  try {
    generated = await generateOwnershipStatementFile(exportInput, payload.ownerName, payload.adminSignatureDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate ownership statement file.";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId } });
    await updateSendJob(documentId, latest?.agreementData || null, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
      message,
    });
    await logShmEvent(documentId, "owner_statement_send_failed", request);
    return { ok: false, status: 500, message };
  }

  const fileName = generated.fileName;
  const fileType = generated.mimeType;
  const fileContent = generated.buffer.toString("base64");
  const docxFileName = generated.docx.fileName;
  const docxFileType = generated.docx.mimeType;
  const docxFileContent = generated.docx.buffer.toString("base64");
  const pdfFileContent = generated.pdf?.buffer.toString("base64");
  const emailAttachments = [
    ...(generated.pdf && pdfFileContent
      ? [{
          fileName: generated.pdf.fileName,
          fileContent: pdfFileContent,
          fileType: generated.pdf.mimeType,
        }]
      : []),
    {
      fileName: docxFileName,
      fileContent: docxFileContent,
      fileType: docxFileType,
    },
  ];

  const emailResult = await sendOwnershipStatementToOwnerEmail({
    to: payload.ownerEmail,
    name: payload.ownerName,
    documentId: doc.documentId,
    documentType: doc.documentType,
    propertyAddress: doc.propertyAddress,
    fileName,
    fileContent,
    fileType,
    attachments: emailAttachments,
    viewToken: (
      await prisma.shmDocumentSigner.findFirst({
        where: { documentId, signerType: "recipient" },
        select: { token: true },
      })
    )?.token || doc.tenantToken || "",
  });

  await logShmEvent(
    documentId,
    emailResult.ok ? "owner_statement_email_sent" : emailResult.skipped ? "owner_statement_email_skipped" : "owner_statement_email_error",
    request,
  );

  if (!emailResult.ok) {
    const message = emailResult.message || "Owner email could not be sent.";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId } });
    await updateSendJob(documentId, latest?.agreementData || null, {
      status: "failed",
      completedAt: new Date().toISOString(),
      emailSent: false,
      error: message,
      message,
    });
    return {
      ok: false,
      status: emailResult.skipped ? 503 : 502,
      message,
      email_sent: false,
    };
  }

  await logShmEvent(documentId, "sent_to_owner", request);

  const completedAt = new Date().toISOString();
  const message = `Ownership statement has been sent to ${payload.ownerEmail}.`;
  const latestAfterEmail = await prisma.shmDocument.findUnique({ where: { documentId } });
  await updateSendJob(documentId, latestAfterEmail?.agreementData || null, {
    status: "completed",
    completedAt,
    emailSent: true,
    driveUpload: false,
    message,
  });

  await prisma.shmDocument.update({
    where: { documentId },
    data: { status: "Sent" },
  });

  // Persist files + Drive upload after the send UI can finish (email already delivered).
  const makeRequest = request || new Request("http://localhost/internal");
  scheduleBackgroundWork((async () => {
    const latestBeforeSave = await prisma.shmDocument.findUnique({ where: { documentId } });
    const mergedAgreementData = mergeAgreementData(latestBeforeSave?.agreementData || null, {
      ...payload.agreementData,
      owner_name: payload.ownerName,
      owner_email: payload.ownerEmail,
      recipientRole: "Owner",
      recipientName: payload.ownerName,
      recipientEmail: payload.ownerEmail,
      admin_signature_date: payload.adminSignatureDate,
      last_submission: {
        signerType: "creator",
        signerName: payload.adminName,
        signerEmail: payload.adminEmail,
        fileName: generated.pdf?.fileName || docxFileName,
        fileType: generated.pdf?.mimeType || docxFileType,
        fileContent: pdfFileContent || docxFileContent,
        pdfFileName: generated.pdf?.fileName,
        pdfFileType: generated.pdf?.mimeType,
        pdfFileContent,
        docxFileName,
        docxFileType,
        docxFileContent,
        signedAt: new Date().toISOString(),
        source: generated.pdf ? "ownership-statement-template.pdf+docx" : "ownership-statement-template.docx",
      },
    });

    await prisma.shmDocument.update({
      where: { documentId },
      data: { agreementData: mergedAgreementData },
    });

    const makeAttachments = generated.pdf && pdfFileContent
      ? [{
          fileName: generated.pdf.fileName,
          fileContent: pdfFileContent,
          fileType: generated.pdf.mimeType,
        }]
      : [];

    const makeResult = await sendPayloadToMake(
      {
        doc: {
          documentId: doc.documentId,
          documentType: doc.documentType,
          recipientName: payload.ownerName,
          recipientEmail: payload.ownerEmail,
        },
        token: doc.adminToken || doc.token,
        fileName: docxFileName,
        fileContent: docxFileContent,
        fileType: docxFileType,
        recipient: { name: payload.ownerName, email: payload.ownerEmail },
        attachments: makeAttachments,
      },
      makeRequest,
    );

    await revokeSignerAccess(documentId, "creator");
    await logShmEvent(documentId, "creator_link_revoked", makeRequest);

    const latest = await prisma.shmDocument.findUnique({ where: { documentId } });
    if (!makeResult.ok) {
      await updateSendJob(documentId, latest?.agreementData || null, {
        driveUpload: false,
        message: `Ownership statement was emailed to ${payload.ownerEmail}, but the Google Drive upload could not be completed.`,
      });
      return;
    }

    await updateSendJob(documentId, latest?.agreementData || null, {
      driveUpload: true,
      message: `Ownership statement has been sent to ${payload.ownerEmail}.`,
    });
  })());

  return {
    ok: true,
    status: 200,
    email_sent: true,
    drive_upload: false,
    message,
  };
}

export function getOwnershipStatementSendJob(agreementDataRaw: string | null) {
  const agreementData = parseAgreementData(agreementDataRaw);
  return readSendJob(agreementData);
}
