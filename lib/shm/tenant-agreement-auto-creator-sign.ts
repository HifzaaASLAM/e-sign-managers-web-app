import { prisma } from "../prisma";
import { createToken, getSignUrl, isTenantAgreement, logShmEvent } from "./documents";
import { loadCreatorAutoSignatureDataUrl } from "./creator-auto-signature";
import { sendPayloadToMake, stripDataUri, normalizeFileType } from "./make";
import { generateTenantAgreementDocxBase64 } from "./tenant-agreement-export";

export type TenantAgreementAutoCreatorSignJobStatus =
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

export type TenantAgreementAutoCreatorSignJob = {
  id: string;
  status: TenantAgreementAutoCreatorSignJobStatus;
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
  const job = agreementData.ta_auto_creator_sign_job;
  if (!job || typeof job !== "object") return null;
  return job as TenantAgreementAutoCreatorSignJob;
}

/** Default 15 minutes; override with TENANT_AGREEMENT_AUTO_CREATOR_SIGN_DELAY_MINUTES. */
export function resolveTenantAgreementAutoCreatorSignDelayMs() {
  const minutes = Number(process.env.TENANT_AGREEMENT_AUTO_CREATOR_SIGN_DELAY_MINUTES || "15");
  if (!Number.isFinite(minutes) || minutes <= 0) return 15 * 60 * 1000;
  return Math.round(minutes * 60 * 1000);
}

export function buildTenantAgreementAutoCreatorSignJob(jobId: string): TenantAgreementAutoCreatorSignJob {
  const scheduledAt = new Date(Date.now() + resolveTenantAgreementAutoCreatorSignDelayMs()).toISOString();
  return {
    id: jobId,
    status: "scheduled",
    scheduledAt,
  };
}

async function updateJob(
  documentId: string,
  existingRaw: string | null,
  patch: Partial<TenantAgreementAutoCreatorSignJob>,
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
        ta_auto_creator_sign_job: { ...current, ...patch },
      }),
    },
  });
}

export async function scheduleTenantAgreementAutoCreatorSign(documentId: string, request?: Request) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isTenantAgreement(doc.documentType)) return null;
  if (doc.adminSignedAt) return null;

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
  const job = buildTenantAgreementAutoCreatorSignJob(jobId);

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(doc.agreementData, { ta_auto_creator_sign_job: job }),
    },
  });

  await logShmEvent(documentId, "tenant_agreement_auto_creator_sign_scheduled", request);

  const { dispatchTenantAgreementAutoCreatorSignJob } = await import("./background-jobs");
  dispatchTenantAgreementAutoCreatorSignJob(documentId, jobId);

  return job;
}

async function buildFinalTenantAgreementSubmission(doc: {
  documentId: string;
  agreementData: string | null;
  tenantSignature: string | null;
  adminSignature: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  propertyAddress: string | null;
  adminName: string | null;
  adminEmail: string | null;
  signedAt: Date;
}) {
  const agreementData = parseAgreementData(doc.agreementData);
  const generated = await generateTenantAgreementDocxBase64(agreementData, {
    documentId: doc.documentId,
    tenantSignature: doc.tenantSignature || undefined,
    providerSignature: doc.adminSignature || undefined,
    signedAt: doc.signedAt,
  });
  const safeId = doc.documentId.replace(/[^\w-]/g, "") || "document";
  const fileName = `Tenant-Agreement-${safeId}-signed.docx`;
  return {
    fileName,
    fileType: generated.mimeType,
    fileContent: generated.base64,
    signedAt: doc.signedAt.toISOString(),
    signerType: "creator",
    signerName: doc.adminName || "ShareHouse Managers",
    signerEmail: doc.adminEmail || "info@sharehousemanagers.com.au",
    creatorAutoSigned: true,
  };
}

export async function processTenantAgreementAutoCreatorSign(
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

  if (!isTenantAgreement(doc.documentType)) {
    return { ok: false, status: 400, message: "Not a tenant agreement." };
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
      message: "Tenant has not signed yet.",
    });
    return { ok: false, status: 409, message: "Tenant has not signed yet." };
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

    await prisma.shmDocumentSigner.findMany({ where: { documentId } });

    const regeneratedSubmission = await buildFinalTenantAgreementSubmission({
      documentId: doc.documentId,
      agreementData: doc.agreementData,
      tenantSignature: doc.tenantSignature,
      adminSignature: creatorSignature,
      recipientName: doc.recipientName,
      recipientEmail: doc.recipientEmail,
      propertyAddress: doc.propertyAddress,
      adminName: creatorName,
      adminEmail: creatorEmail,
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
          provider_signature: creatorSignature,
          auto_creator_signed_at: signedAt.toISOString(),
          last_submission: regeneratedSubmission,
          ta_auto_creator_sign_job: {
            ...job,
            status: "completed",
            completedAt: signedAt.toISOString(),
            message: "Creator signature applied automatically from configured asset.",
          },
        }),
      },
    });

    await logShmEvent(documentId, "tenant_agreement_auto_creator_signed", request);

    const uploadToken = doc.adminToken || doc.tenantToken || creatorSigner.token;
    const fileType = normalizeFileType(regeneratedSubmission.fileType, regeneratedSubmission.fileName);
    const result = await sendPayloadToMake(
      {
        doc: {
          documentType: doc.documentType,
          documentId: doc.documentId,
          recipientName: doc.recipientName,
          recipientEmail: doc.recipientEmail,
        },
        token: uploadToken,
        fileName: regeneratedSubmission.fileName,
        fileContent: stripDataUri(regeneratedSubmission.fileContent),
        fileType,
        recipient: { name: doc.recipientName, email: doc.recipientEmail },
        signerName: creatorName,
      },
      request,
    );

    if (!result.ok) {
      await prisma.shmDocument.update({
        where: { documentId },
        data: { status: "Make Error" },
      });
      await logShmEvent(documentId, `tenant_agreement_auto_creator_make_failed_${result.status || "unknown"}`, request);
      return { ok: false, status: 502, message: "Creator signed but Drive upload failed." };
    }

    await logShmEvent(documentId, "signed_complete", request);
    return { ok: true, status: 200, message: "Creator auto-signed and document submitted for final processing." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto creator sign failed.";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId }, select: { agreementData: true } });
    await updateJob(documentId, latest?.agreementData || doc.agreementData, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    await logShmEvent(documentId, "tenant_agreement_auto_creator_sign_failed", request);
    return { ok: false, status: 500, message };
  }
}

export async function runDueTenantAgreementAutoCreatorSigns(request?: Request) {
  const docs = await prisma.shmDocument.findMany({
    where: {
      documentType: "Tenant Agreement",
      adminSignedAt: null,
    },
    select: {
      documentId: true,
      agreementData: true,
      tenantSignedAt: true,
      signedAt: true,
    },
    take: 100,
  });

  const now = Date.now();
  const results: Array<{ documentId: string; ok: boolean; message: string }> = [];

  for (const doc of docs) {
    const agreementData = parseAgreementData(doc.agreementData);
    const job = readJob(agreementData);
    if (!job || job.status !== "scheduled") continue;
    if (!doc.tenantSignedAt && !doc.signedAt) continue;
    if (Date.parse(job.scheduledAt) > now) continue;

    const result = await processTenantAgreementAutoCreatorSign(doc.documentId, job.id, request);
    results.push({
      documentId: doc.documentId,
      ok: result.ok,
      message: result.message,
    });
  }

  return results;
}
