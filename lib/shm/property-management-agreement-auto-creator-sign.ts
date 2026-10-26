import { prisma } from "../prisma";
import { createToken, getSignUrl, isPropertyManagementAgreement, logShmEvent } from "./documents";
import { loadCreatorAutoSignatureDataUrl } from "./creator-auto-signature";
import {
  buildPropertyManagementAgreementDriveFolderName,
  normalizeMakeDriveFileName,
  sendPayloadToMake,
  stripDataUri,
} from "./make";
import { revokeSignerAccess } from "./signing-access";
import { generatePropertyManagementAgreementBuiltDocx } from "./property-management-agreement-built-docx";
import { mergePmaFieldValues, parsePmaAgreementData } from "./property-management-agreement-fields";
import { resolvePmaSignatureDataUrls } from "./property-management-agreement-signatures";

export type PmaAutoCreatorSignJobStatus =
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

export type PmaAutoCreatorSignJob = {
  id: string;
  status: PmaAutoCreatorSignJobStatus;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
  error?: string;
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

function readJob(agreementData: Record<string, unknown>) {
  const job = agreementData.pma_auto_creator_sign_job;
  if (!job || typeof job !== "object") return null;
  return job as PmaAutoCreatorSignJob;
}

/** Default 3 minutes; override with PMA_AUTO_CREATOR_SIGN_DELAY_MINUTES. */
export function resolvePmaAutoCreatorSignDelayMs() {
  const fromPma = process.env.PMA_AUTO_CREATOR_SIGN_DELAY_MINUTES?.trim();
  const raw = fromPma || "3";
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return 3 * 60 * 1000;
  return Math.round(minutes * 60 * 1000);
}

export function buildPmaAutoCreatorSignJob(jobId: string, scheduledAt?: Date): PmaAutoCreatorSignJob {
  const at = scheduledAt || new Date(Date.now() + resolvePmaAutoCreatorSignDelayMs());
  return {
    id: jobId,
    status: "scheduled",
    scheduledAt: at.toISOString(),
  };
}

async function updateJob(
  documentId: string,
  existingRaw: string | null,
  patch: Partial<PmaAutoCreatorSignJob>,
  extra?: Record<string, unknown>,
) {
  const existing = parseAgreementData(existingRaw);
  const current = readJob(existing);
  if (!current) return;

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(existingRaw, {
        ...extra,
        pma_auto_creator_sign_job: { ...current, ...patch },
      }),
    },
  });
}

export async function schedulePmaAutoCreatorSign(documentId: string, request?: Request) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isPropertyManagementAgreement(doc.documentType)) return null;
  if (doc.adminSignedAt) return null;
  if (!doc.tenantSignedAt && !doc.signedAt) return null;

  const agreementData = parseAgreementData(doc.agreementData);
  const existingJob = readJob(agreementData);
  if (
    existingJob
    && (existingJob.status === "scheduled"
      || existingJob.status === "processing"
      || existingJob.status === "completed")
  ) {
    return existingJob;
  }

  const jobId = createToken().slice(0, 24);
  const job = buildPmaAutoCreatorSignJob(jobId);

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(doc.agreementData, { pma_auto_creator_sign_job: job }),
    },
  });

  await logShmEvent(documentId, "pma_auto_creator_sign_scheduled", request);

  const { dispatchPmaAutoCreatorSignJob } = await import("./background-jobs");
  dispatchPmaAutoCreatorSignJob(documentId, jobId);

  return job;
}

async function buildFinalPmaUpload(doc: {
  documentId: string;
  agreementData: string | null;
  tenantSignature: string | null;
  adminSignature: string | null;
  recipientName: string | null;
  signedAt: Date;
}) {
  const stored = parsePmaAgreementData(doc.agreementData);
  const fieldValues = mergePmaFieldValues(stored, {});
  const signedAt = doc.signedAt;
  const melbourneSubmitted = signedAt.toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  const dateAu = `${String(signedAt.getDate()).padStart(2, "0")}/${String(signedAt.getMonth() + 1).padStart(2, "0")}/${signedAt.getFullYear()}`;

  const signers = await prisma.shmDocumentSigner.findMany({ where: { documentId: doc.documentId } });
  const { ownerSignature, agentSignature } = await resolvePmaSignatureDataUrls({
    signers,
    doc: {
      tenantSignature: doc.tenantSignature,
      adminSignature: doc.adminSignature,
      adminSignedAt: doc.signedAt,
      tenantSignedAt: doc.signedAt,
      signedAt: doc.signedAt,
    },
    agreementData: fieldValues,
  });

  const rebuilt = await generatePropertyManagementAgreementBuiltDocx(
    {
      ...fieldValues,
      submittedAt: melbourneSubmitted,
      agent_sig_date: fieldValues.agent_sig_date || dateAu,
      sig_date: fieldValues.sig_date || dateAu,
    },
    {
      ownerSignature,
      agentSignature,
    },
  );

  const signerName = String(fieldValues.owner_sign_name || fieldValues.owner || doc.recipientName || "Owner").trim();
  const fileName = normalizeMakeDriveFileName(
    `Property-Management-Agreement-${signerName}-${signedAt.toISOString().slice(0, 10)}.docx`,
    "docx",
  );

  return {
    fileName,
    fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileContent: rebuilt.toString("base64"),
    signerName,
    driveFolderName: buildPropertyManagementAgreementDriveFolderName(signerName),
  };
}

export async function processPmaAutoCreatorSign(
  documentId: string,
  jobId: string,
  request?: Request,
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });

  if (!doc) {
    return { ok: false, status: 404, message: "Document not found." };
  }

  if (!isPropertyManagementAgreement(doc.documentType)) {
    return { ok: false, status: 400, message: "Not a Property Management Agreement." };
  }

  const agreementData = parseAgreementData(doc.agreementData);
  const job = readJob(agreementData);
  if (!job || job.id !== jobId) {
    return { ok: false, status: 409, message: "Auto creator sign job not found or already replaced." };
  }

  if (job.status === "completed" || job.status === "skipped") {
    return { ok: true, status: 200, message: "Auto creator sign already finished." };
  }

  if (job.status === "processing") {
    return { ok: true, status: 202, message: "Auto creator sign already in progress." };
  }

  const scheduledAtMs = Date.parse(job.scheduledAt);
  if (Number.isFinite(scheduledAtMs) && Date.now() < scheduledAtMs - 5000) {
    return { ok: false, status: 425, message: "Auto creator sign is not due yet." };
  }

  if (!doc.tenantSignedAt && !doc.signedAt) {
    await updateJob(documentId, doc.agreementData, {
      status: "skipped",
      completedAt: new Date().toISOString(),
      message: "Owner has not signed yet.",
    });
    return { ok: false, status: 409, message: "Owner has not signed yet." };
  }

  if (doc.adminSignedAt) {
    await updateJob(documentId, doc.agreementData, {
      status: "skipped",
      completedAt: new Date().toISOString(),
      message: "Creator signature already recorded.",
    });
    return { ok: true, status: 200, message: "Creator signature already recorded." };
  }

  await updateJob(documentId, doc.agreementData, {
    status: "processing",
    startedAt: new Date().toISOString(),
  });

  try {
    const creatorSignature = await loadCreatorAutoSignatureDataUrl();
    const signedAt = new Date();
    const creatorName = doc.adminName || "ShareHouse Managers";
    const creatorEmail = doc.adminEmail || "info@sharehousemanagers.com.au";

    let creatorSigner = doc.signers.find((signer) => signer.signerType === "creator") || null;
    if (!creatorSigner) {
      const creatorToken = doc.adminToken || createToken();
      creatorSigner = await prisma.shmDocumentSigner.create({
        data: {
          id: createToken(),
          documentId: doc.documentId,
          name: creatorName,
          email: creatorEmail,
          role: "Creator",
          signerType: "creator",
          token: creatorToken,
          signingUrl: getSignUrl(doc.documentId, creatorToken, "creator"),
          status: "Signed",
          signature: creatorSignature,
          signedAt,
        },
      });

      if (!doc.adminToken) {
        await prisma.shmDocument.update({
          where: { documentId },
          data: { adminToken: creatorToken },
        });
      }
    } else {
      await prisma.shmDocumentSigner.update({
        where: { id: creatorSigner.id },
        data: {
          status: "Signed",
          signature: creatorSignature,
          signedAt,
        },
      });
    }

    const upload = await buildFinalPmaUpload({
      documentId: doc.documentId,
      agreementData: doc.agreementData,
      tenantSignature: doc.tenantSignature,
      adminSignature: creatorSignature,
      recipientName: doc.recipientName,
      signedAt,
    });

    const latestForMerge = await prisma.shmDocument.findUnique({
      where: { documentId },
      select: { agreementData: true },
    });

    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        adminSignature: creatorSignature,
        adminSignedAt: signedAt,
        status: "Processing",
        agreementData: mergeAgreementData(latestForMerge?.agreementData || doc.agreementData, {
          admin_signature: creatorSignature,
          agent_signature: creatorSignature,
          auto_creator_signed_at: signedAt.toISOString(),
          last_submission: {
            signerType: "creator",
            signerName: creatorName,
            signerEmail: creatorEmail,
            fileName: upload.fileName,
            fileType: upload.fileType,
            signedAt: signedAt.toISOString(),
            creatorAutoSigned: true,
          },
          pma_auto_creator_sign_job: {
            ...job,
            status: "completed",
            completedAt: signedAt.toISOString(),
            message: "Creator signature applied automatically from configured asset.",
          },
        }),
      },
    });

    await logShmEvent(documentId, "pma_auto_creator_signed", request);

    const uploadToken = doc.adminToken || doc.tenantToken || creatorSigner.token;
    const result = await sendPayloadToMake(
      {
        doc: {
          documentType: doc.documentType,
          documentId: doc.documentId,
          recipientName: doc.recipientName,
          recipientEmail: doc.recipientEmail,
        },
        token: uploadToken,
        fileName: upload.fileName,
        fileContent: stripDataUri(upload.fileContent),
        fileType: upload.fileType,
        recipient: { name: doc.recipientName, email: doc.recipientEmail },
        signerName: upload.signerName,
        driveFolderName: upload.driveFolderName,
        attachments: [],
      },
      request,
    );

    if (!result.ok) {
      const { attemptPmaEmailRecoveryOnUploadFailure } = await import("./pma-final-delivery-emails");
      const recovery = await attemptPmaEmailRecoveryOnUploadFailure(documentId, request);
      if (!recovery.ok) {
        await prisma.shmDocument.update({
          where: { documentId },
          data: { status: "Make Error" },
        });
      }
      await logShmEvent(documentId, `pma_auto_creator_make_failed_${result.status || "unknown"}`, request);
      return {
        ok: recovery.ok,
        status: recovery.ok ? 200 : 502,
        message: recovery.ok
          ? "Creator signed. Final document emailed; Drive upload can be retried from dashboard."
          : "Creator signed but Drive upload failed.",
      };
    }

    await revokeSignerAccess(documentId, "recipient");
    await revokeSignerAccess(documentId, "creator");
    await logShmEvent(documentId, "pma_links_revoked_after_final_delivery", request);
    await logShmEvent(documentId, "signed_complete", request);

    return { ok: true, status: 200, message: "Creator auto-signed and final document sent to Drive." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto creator sign failed.";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId }, select: { agreementData: true } });
    await updateJob(documentId, latest?.agreementData || doc.agreementData, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    await logShmEvent(documentId, "pma_auto_creator_sign_failed", request);
    return { ok: false, status: 500, message };
  }
}

/** Backfill: owner signed long ago but no active job — schedule immediate run. */
async function ensureBackfillJob(documentId: string, tenantSignedAt: Date | null, agreementDataRaw: string | null) {
  if (!tenantSignedAt) return null;
  const agreementData = parseAgreementData(agreementDataRaw);
  const job = readJob(agreementData);
  if (job && (job.status === "scheduled" || job.status === "processing" || job.status === "completed")) {
    return job;
  }

  const delayMs = resolvePmaAutoCreatorSignDelayMs();
  const ageMs = Date.now() - tenantSignedAt.getTime();
  if (ageMs < delayMs) return null;

  const jobId = createToken().slice(0, 24);
  const immediateJob = buildPmaAutoCreatorSignJob(jobId, new Date(Date.now() - 1000));
  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(agreementDataRaw, { pma_auto_creator_sign_job: immediateJob }),
    },
  });
  return immediateJob;
}

async function runDuePmaAutoCreatorSignRow(
  doc: {
    documentId: string;
    agreementData: string | null;
    tenantSignedAt: Date | null;
    signedAt: Date | null;
  },
  request?: Request,
) {
  if (!doc.tenantSignedAt && !doc.signedAt) return null;

  const now = Date.now();
  let agreementData = parseAgreementData(doc.agreementData);
  let job = readJob(agreementData);

  if (!job || job.status === "failed") {
    const backfill = await ensureBackfillJob(doc.documentId, doc.tenantSignedAt || doc.signedAt, doc.agreementData);
    if (backfill) {
      job = backfill;
      agreementData = parseAgreementData(
        (await prisma.shmDocument.findUnique({ where: { documentId: doc.documentId }, select: { agreementData: true } }))
          ?.agreementData || doc.agreementData,
      );
      job = readJob(agreementData) || backfill;
    }
  }

  if (!job || job.status !== "scheduled") return null;
  if (Date.parse(job.scheduledAt) > now) return null;

  const result = await processPmaAutoCreatorSign(doc.documentId, job.id, request);
  return {
    documentId: doc.documentId,
    ok: result.ok,
    message: result.message,
  };
}

export async function runDuePmaAutoCreatorSignForDocument(documentId: string, request?: Request) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    select: {
      documentId: true,
      documentType: true,
      agreementData: true,
      tenantSignedAt: true,
      signedAt: true,
      adminSignedAt: true,
    },
  });
  if (!doc || !isPropertyManagementAgreement(doc.documentType) || doc.adminSignedAt) {
    return null;
  }
  return runDuePmaAutoCreatorSignRow(doc, request);
}

export async function runDuePmaAutoCreatorSigns(
  request?: Request,
  options?: { documentIds?: string[]; max?: number },
) {
  const max = Math.max(1, Math.min(options?.max ?? 100, 100));
  const ids = options?.documentIds?.filter(Boolean);

  const docs = await prisma.shmDocument.findMany({
    where: {
      documentType: "Property Management Agreement",
      adminSignedAt: null,
      ...(ids?.length ? { documentId: { in: ids } } : {}),
    },
    select: {
      documentId: true,
      agreementData: true,
      tenantSignedAt: true,
      signedAt: true,
    },
    take: ids?.length ? Math.min(ids.length, max) : max,
  });

  const results: Array<{ documentId: string; ok: boolean; message: string }> = [];

  for (const doc of docs) {
    const row = await runDuePmaAutoCreatorSignRow(doc, request);
    if (row) results.push(row);
    if (results.length >= max) break;
  }

  return results;
}
