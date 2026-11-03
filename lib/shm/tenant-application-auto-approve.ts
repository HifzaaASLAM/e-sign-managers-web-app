import { prisma } from "../prisma";
import { createToken, isTenantApplication, logShmEvent, rollupDocumentStatus } from "./documents";
import { loadCreatorAutoSignatureDataUrl } from "./creator-auto-signature";
import {
  sendTenantApplicationApprovedEmail,
  sendTenantApplicationFinalApplicantEmail,
  sendTenantApplicationFinalInfoEmail,
} from "./mailer";

export type TenantApplicationAutoApproveJobStatus = "scheduled" | "processing" | "completed" | "failed" | "skipped";

export type TenantApplicationAutoApproveJob = {
  id: string;
  status: TenantApplicationAutoApproveJobStatus;
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

function readAutoApproveJob(agreementData: Record<string, unknown>) {
  const job = agreementData.auto_approve_job;
  if (!job || typeof job !== "object") return null;
  return job as TenantApplicationAutoApproveJob;
}

export function resolveTenantApplicationAutoApproveDelayMs() {
  const minutes = Number(process.env.TENANT_APPLICATION_AUTO_APPROVE_DELAY_MINUTES || "3");
  if (!Number.isFinite(minutes) || minutes <= 0) return 3 * 60 * 1000;
  return Math.round(minutes * 60 * 1000);
}

export function buildTenantApplicationAutoApproveJob(jobId: string): TenantApplicationAutoApproveJob {
  const scheduledAt = new Date(Date.now() + resolveTenantApplicationAutoApproveDelayMs()).toISOString();
  return {
    id: jobId,
    status: "scheduled",
    scheduledAt,
  };
}

type AutoApproveClaimResult = "claimed" | "already_done" | "not_due" | "in_progress" | "not_signed" | "conflict";

/** One worker only — avoids duplicate final emails when HTTP + in-process + pending runner overlap. */
async function tryClaimTenantApplicationAutoApproveJob(
  documentId: string,
  jobId: string,
): Promise<AutoApproveClaimResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.shmDocument.findUnique({
      where: { documentId },
      select: {
        agreementData: true,
        adminSignedAt: true,
        tenantSignedAt: true,
        signedAt: true,
      },
    });
    if (!row) return "conflict";

    if (row.adminSignedAt) return "already_done";

    const agreementData = parseAgreementData(row.agreementData);
    const job = readAutoApproveJob(agreementData);
    if (!job || job.id !== jobId) return "conflict";

    if (job.status === "completed" || job.status === "skipped") return "already_done";
    if (job.status === "processing") return "in_progress";
    if (job.status !== "scheduled") return "conflict";

    const scheduledAtMs = Date.parse(job.scheduledAt);
    if (Number.isFinite(scheduledAtMs) && Date.now() < scheduledAtMs - 5000) return "not_due";

    if (!row.tenantSignedAt && !row.signedAt) return "not_signed";

    await tx.shmDocument.update({
      where: { documentId },
      data: {
        agreementData: mergeAgreementData(row.agreementData, {
          auto_approve_job: {
            ...job,
            status: "processing",
            startedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return "claimed";
  });
}

async function updateAutoApproveJob(
  documentId: string,
  existingRaw: string | null,
  patch: Partial<TenantApplicationAutoApproveJob>,
  extra?: Record<string, unknown>,
) {
  const existing = parseAgreementData(existingRaw);
  const current = readAutoApproveJob(existing);
  if (!current) return;

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(existingRaw, {
        ...extra,
        auto_approve_job: { ...current, ...patch },
      }),
    },
  });
}

export async function scheduleTenantApplicationAutoApprove(documentId: string, request?: Request) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isTenantApplication(doc.documentType)) return null;

  const agreementData = parseAgreementData(doc.agreementData);
  const existingJob = readAutoApproveJob(agreementData);
  if (existingJob && (existingJob.status === "scheduled" || existingJob.status === "processing" || existingJob.status === "completed")) {
    return existingJob;
  }

  const jobId = createToken().slice(0, 24);
  const job = buildTenantApplicationAutoApproveJob(jobId);

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      agreementData: mergeAgreementData(doc.agreementData, { auto_approve_job: job }),
    },
  });

  await logShmEvent(documentId, "tenant_application_auto_approve_scheduled", request);

  const { dispatchTenantApplicationAutoApproveJob } = await import("./background-jobs");
  dispatchTenantApplicationAutoApproveJob(documentId, jobId);

  return job;
}

export async function processTenantApplicationAutoApprove(
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

  if (!isTenantApplication(doc.documentType)) {
    return { ok: false, status: 400, message: "Not a tenant application." };
  }

  const agreementData = parseAgreementData(doc.agreementData);
  const job = readAutoApproveJob(agreementData);
  if (!job || job.id !== jobId) {
    return { ok: false, status: 409, message: "Auto-approve job not found or already replaced." };
  }

  if (job.status === "completed" || job.status === "skipped") {
    return { ok: true, status: 200, message: "Auto-approve already finished." };
  }

  const claim = await tryClaimTenantApplicationAutoApproveJob(documentId, jobId);
  if (claim === "already_done") {
    return { ok: true, status: 200, message: "Creator signature already recorded." };
  }
  if (claim === "in_progress") {
    return { ok: true, status: 202, message: "Auto-approve already in progress." };
  }
  if (claim === "not_due") {
    return { ok: false, status: 425, message: "Auto-approve is not due yet." };
  }
  if (claim === "not_signed") {
    await updateAutoApproveJob(documentId, doc.agreementData, {
      status: "skipped",
      completedAt: new Date().toISOString(),
      message: "Recipient has not signed yet.",
    });
    return { ok: false, status: 409, message: "Recipient has not signed yet." };
  }
  if (claim !== "claimed") {
    return { ok: false, status: 409, message: "Auto-approve job not available." };
  }

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

    const updatedSigners = await prisma.shmDocumentSigner.findMany({ where: { documentId } });
    const nextStatus = rollupDocumentStatus(updatedSigners, doc.status, doc.documentType);
    const fieldValues =
      (agreementData.field_values as Record<string, unknown> | undefined) ||
      (agreementData.fieldValues as Record<string, unknown> | undefined) ||
      {};

    const applicantEmail = String(fieldValues.e_email || doc.recipientEmail || "").trim().toLowerCase();
    const applicantFirst = String(fieldValues.e_first || "").trim();
    const applicantLast = String(fieldValues.e_last || "").trim();
    const applicantName =
      [applicantFirst, applicantLast].filter(Boolean).join(" ") ||
      doc.recipientName ||
      "Applicant";
    const propertyAddress = String(fieldValues.d_addr || doc.propertyAddress || "").trim() || undefined;

    // Physically stamp creator signature + audit trail into the final Tenant Application DOCX.
    let regeneratedSubmission: {
      fileName: string;
      fileType: string;
      fileContent: string;
      signedAt: string;
      signerType: string;
      signerName: string;
      signerEmail: string;
      creatorStamped: boolean;
      auditIncluded?: boolean;
    } | null = null;

    try {
      const { regenerateTenantApplicationFinalDocx } = await import("./tenant-application-final-docx");
      const result = await regenerateTenantApplicationFinalDocx({
        documentId,
        request,
        creatorName,
        creatorEmail,
        creatorSignatureDataUrl: creatorSignature,
        signedAt,
      });
      regeneratedSubmission = result.regeneratedSubmission;
    } catch (error) {
      console.error("[tenant-application-auto-approve] DOCX stamp failed", error);
      await logShmEvent(documentId, "tenant_application_creator_stamp_failed", request);
    }

    const latestForMerge = await prisma.shmDocument.findUnique({
      where: { documentId },
      select: { agreementData: true },
    });

    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        adminSignature: creatorSignature,
        adminSignedAt: signedAt,
        status: regeneratedSubmission ? "Processing" : nextStatus === "Make Error" ? doc.status : "Signed",
        agreementData: mergeAgreementData(latestForMerge?.agreementData || doc.agreementData, {
          admin_signature: creatorSignature,
          provider_signature: creatorSignature,
          auto_approved_at: signedAt.toISOString(),
          field_values: {
            ...fieldValues,
            provider_sig: creatorSignature,
            provider_sigdt: signedAt.toISOString().slice(0, 10),
          },
          ...(regeneratedSubmission
            ? {
                last_submission: regeneratedSubmission,
                creator_stamped_docx_at: signedAt.toISOString(),
              }
            : {}),
          auto_approve_job: {
            ...job,
            status: "completed",
            completedAt: signedAt.toISOString(),
            message: regeneratedSubmission
              ? "Agent signature stamped into final DOCX."
              : "Creator signature applied automatically (DOCX stamp skipped).",
          },
        }),
      },
    });

    await logShmEvent(documentId, "tenant_application_auto_approved", request);

    const afterApproveRow = await prisma.shmDocument.findUnique({
      where: { documentId },
      select: { agreementData: true },
    });
    const afterApproveData = parseAgreementData(afterApproveRow?.agreementData || null);
    const finalEmailsAlreadySent = Boolean(afterApproveData.tenant_application_final_emails_sent_at);

    if (regeneratedSubmission?.fileContent && !finalEmailsAlreadySent) {
      const { buildTenantApplicationFinalPdfAttachments } = await import(
        "./tenant-application-final-email-attachment"
      );
      const attachments = await buildTenantApplicationFinalPdfAttachments(regeneratedSubmission);
      if (!attachments.length) {
        await logShmEvent(documentId, "tenant_application_final_email_attachment_failed", request);
      } else if (!attachments[0]?.fileName.toLowerCase().endsWith(".pdf")) {
        await logShmEvent(documentId, "tenant_application_final_email_attached_docx", request);
      }

      if (applicantEmail) {
        const applicantCopy = await sendTenantApplicationFinalApplicantEmail({
          to: applicantEmail,
          name: applicantName,
          documentId: doc.documentId,
          propertyAddress,
          applicantName,
          applicantEmail,
          attachments,
        });
        await logShmEvent(
          documentId,
          applicantCopy.ok
            ? "tenant_application_final_applicant_email_sent"
            : applicantCopy.skipped
              ? "tenant_application_final_applicant_email_skipped"
              : "tenant_application_final_applicant_email_error",
          request,
        );
      }

      const infoCopy = await sendTenantApplicationFinalInfoEmail({
        documentId: doc.documentId,
        propertyAddress,
        applicantName,
        applicantEmail,
        attachments,
      });
      await logShmEvent(
        documentId,
        infoCopy.ok
          ? "tenant_application_final_info_email_sent"
          : infoCopy.skipped
            ? "tenant_application_final_info_email_skipped"
            : "tenant_application_final_info_email_error",
        request,
      );

      await prisma.shmDocument.update({
        where: { documentId },
        data: {
          agreementData: mergeAgreementData(afterApproveRow?.agreementData || null, {
            tenant_application_final_emails_sent_at: signedAt.toISOString(),
          }),
        },
      });
    }

    const { readLandlordFromAgreement, getLandlordReviewUrl } = await import("./tenant-application-landlord");
    const landlord = readLandlordFromAgreement(agreementData);

    if (landlord && landlord.status !== "approved") {
      const reviewUrl = getLandlordReviewUrl(doc.documentId, landlord.token);
      const { sendLandlordReviewInviteEmail } = await import("./mailer");
      const inviteResult = await sendLandlordReviewInviteEmail({
        to: landlord.email,
        landlordName: landlord.name,
        applicantName,
        propertyAddress,
        documentId: doc.documentId,
        reviewUrl,
        rentAmount: fieldValues.d_rent,
      });

      const latest = await prisma.shmDocument.findUnique({
        where: { documentId },
        select: { agreementData: true },
      });
      await prisma.shmDocument.update({
        where: { documentId },
        data: {
          agreementData: mergeAgreementData(latest?.agreementData || doc.agreementData, {
            landlord: {
              ...landlord,
              status: "invited",
              invitedAt: new Date().toISOString(),
              reviewUrl,
            },
          }),
        },
      });

      await logShmEvent(
        documentId,
        inviteResult.ok
          ? "landlord_review_invite_sent"
          : inviteResult.skipped
            ? "landlord_review_invite_skipped"
            : "landlord_review_invite_error",
        request,
      );
    } else if (applicantEmail && !regeneratedSubmission?.fileContent) {
      const emailResult = await sendTenantApplicationApprovedEmail({
        to: applicantEmail,
        name: applicantName,
        documentId: doc.documentId,
        propertyAddress,
      });
      await logShmEvent(
        documentId,
        emailResult.ok
          ? "tenant_application_approved_email_sent"
          : emailResult.skipped
            ? "tenant_application_approved_email_skipped"
            : "tenant_application_approved_email_error",
        request,
      );
    }

    return { ok: true, status: 200, message: "Tenant application auto-approved." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-approve failed.";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId }, select: { agreementData: true } });
    await updateAutoApproveJob(documentId, latest?.agreementData || doc.agreementData, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    await logShmEvent(documentId, "tenant_application_auto_approve_failed", request);
    return { ok: false, status: 500, message };
  }
}

export async function runDueTenantApplicationAutoApprovals(request?: Request) {
  const docs = await prisma.shmDocument.findMany({
    where: {
      documentType: "Tenant Application",
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
    const job = readAutoApproveJob(agreementData);
    if (!job || job.status !== "scheduled") continue;
    if (!doc.tenantSignedAt && !doc.signedAt) continue;
    if (Date.parse(job.scheduledAt) > now) continue;

    const result = await processTenantApplicationAutoApprove(doc.documentId, job.id, request);
    results.push({
      documentId: doc.documentId,
      ok: result.ok,
      message: result.message,
    });
  }

  return results;
}

/** Run due auto-approve for one document (landlord page / dashboard safety net). */
export async function ensureTenantApplicationAutoApproveForDocument(
  documentId: string,
  request?: Request,
) {
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
  if (!doc || !isTenantApplication(doc.documentType)) return null;

  const agreementData = parseAgreementData(doc.agreementData);
  const job = readAutoApproveJob(agreementData);
  if (!job) return null;

  if (job.status === "scheduled" && (doc.tenantSignedAt || doc.signedAt) && !doc.adminSignedAt) {
    if (Date.parse(job.scheduledAt) <= Date.now()) {
      return processTenantApplicationAutoApprove(documentId, job.id, request);
    }
  }

  // If creator already approved but stamp never landed, regenerate final DOCX now.
  const stampedAt = agreementData.creator_stamped_docx_at;
  const last = agreementData.last_submission;
  const lastObj = last && typeof last === "object" ? (last as Record<string, unknown>) : null;
  const alreadyStamped = Boolean(stampedAt) || Boolean(lastObj?.creatorStamped);
  if (doc.adminSignedAt && !alreadyStamped) {
    try {
      const { regenerateTenantApplicationFinalDocx } = await import("./tenant-application-final-docx");
      const result = await regenerateTenantApplicationFinalDocx({
        documentId,
        request,
        signedAt: doc.adminSignedAt,
      });
      await prisma.shmDocument.update({
        where: { documentId },
        data: {
          agreementData: mergeAgreementData(doc.agreementData, {
            last_submission: result.regeneratedSubmission,
            creator_stamped_docx_at: new Date().toISOString(),
          }),
        },
      });
      await logShmEvent(documentId, "tenant_application_creator_stamp_repaired", request);
      return { ok: true, status: 200, message: "Creator stamp repaired on final DOCX." };
    } catch (error) {
      console.error("[tenant-application] stamp repair failed", error);
      await logShmEvent(documentId, "tenant_application_creator_stamp_repair_failed", request);
    }
  }

  return null;
}
