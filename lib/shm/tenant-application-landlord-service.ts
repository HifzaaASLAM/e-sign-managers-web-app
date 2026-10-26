import { prisma } from "../prisma";
import { isTenantApplication, logShmEvent } from "./documents";
import {
  readLandlordFromAgreement,
  tenantSummaryFromFields,
  type LandlordRecord,
} from "./tenant-application-landlord";
import { sendLandlordApprovalNotifications } from "./mailer";
import { formatRentDisplay } from "./tenant-application-prefill";

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

function unwrapFields(agreementData: Record<string, unknown>) {
  return (
    (agreementData.field_values as Record<string, unknown> | undefined) ||
    (agreementData.fieldValues as Record<string, unknown> | undefined) ||
    {}
  );
}

async function resolveCreatorContact(doc: {
  adminEmail: string | null;
  adminName: string | null;
  createdById: string | null;
}) {
  let creatorEmail = String(doc.adminEmail || "").trim().toLowerCase();
  let creatorName = String(doc.adminName || "").trim() || "Creator";

  if (!creatorEmail && doc.createdById) {
    const user = await prisma.user.findUnique({
      where: { id: doc.createdById },
      select: { email: true, name: true },
    });
    if (user?.email) {
      creatorEmail = user.email.trim().toLowerCase();
      if (!doc.adminName && user.name) creatorName = user.name;
    }
  }

  return { creatorEmail, creatorName };
}

export async function getLandlordReviewBundle(documentId: string, token: string, request?: Request) {
  // Catch delayed auto-approve / missing stamp before the landlord reviews.
  try {
    const { ensureTenantApplicationAutoApproveForDocument } = await import("./tenant-application-auto-approve");
    await ensureTenantApplicationAutoApproveForDocument(documentId, request);
  } catch (error) {
    console.error("[landlord-review] ensure auto-approve failed", error);
  }

  const doc = await prisma.shmDocument.findUnique({ where: { documentId } });
  if (!doc || !isTenantApplication(doc.documentType)) {
    return { ok: false as const, status: 404, message: "Application not found." };
  }

  const agreementData = parseAgreementData(doc.agreementData);
  const landlord = readLandlordFromAgreement(agreementData);
  if (!landlord || landlord.token !== token) {
    return { ok: false as const, status: 403, message: "Invalid or expired landlord review link." };
  }

  const fields = unwrapFields(agreementData);
  const tenant = tenantSummaryFromFields(fields, {
    name: doc.recipientName,
    email: doc.recipientEmail,
    propertyAddress: doc.propertyAddress,
  });

  return {
    ok: true as const,
    status: 200,
    document: {
      documentId: doc.documentId,
      propertyAddress: doc.propertyAddress,
      status: doc.status,
      tenantSignedAt: doc.tenantSignedAt,
      adminSignedAt: doc.adminSignedAt,
    },
    landlord: {
      name: landlord.name,
      email: landlord.email,
      status: landlord.status,
      approvedAt: landlord.approvedAt,
    },
    tenant: {
      ...tenant,
      rentDisplay: formatRentDisplay(tenant.rent),
    },
  };
}

export async function approveTenantByLandlord(input: {
  documentId: string;
  token: string;
  request?: Request;
}) {
  const doc = await prisma.shmDocument.findUnique({ where: { documentId: input.documentId } });
  if (!doc || !isTenantApplication(doc.documentType)) {
    return { ok: false as const, status: 404, message: "Application not found." };
  }

  const agreementData = parseAgreementData(doc.agreementData);
  const landlord = readLandlordFromAgreement(agreementData);
  if (!landlord || landlord.token !== input.token) {
    return { ok: false as const, status: 403, message: "Invalid or expired landlord review link." };
  }

  const alreadyApproved = landlord.status === "approved";
  const approvedAt = alreadyApproved
    ? String(landlord.approvedAt || agreementData.landlord_approved_at || new Date().toISOString())
    : new Date().toISOString();

  if (!alreadyApproved) {
    if (!doc.tenantSignedAt && !doc.signedAt) {
      return {
        ok: false as const,
        status: 409,
        message: "The applicant has not signed this application yet.",
      };
    }

    const nextLandlord: LandlordRecord = {
      ...landlord,
      status: "approved",
      approvedAt,
    };

    await prisma.shmDocument.update({
      where: { documentId: input.documentId },
      data: {
        agreementData: mergeAgreementData(doc.agreementData, {
          landlord: nextLandlord,
          landlord_approved_at: approvedAt,
        }),
      },
    });

    await logShmEvent(input.documentId, "landlord_approved_tenant", input.request);
  }

  const fields = unwrapFields(agreementData);
  const tenant = tenantSummaryFromFields(fields, {
    name: doc.recipientName,
    email: doc.recipientEmail,
    propertyAddress: doc.propertyAddress,
  });

  const applicantEmail = String(tenant.email || doc.recipientEmail || "").trim().toLowerCase();
  const applicantName = tenant.name || doc.recipientName || "Applicant";
  const { creatorEmail, creatorName } = await resolveCreatorContact(doc);

  // Refresh final DOCX so audit trail includes landlord approval.
  try {
    const { regenerateTenantApplicationFinalDocx } = await import("./tenant-application-final-docx");
    const result = await regenerateTenantApplicationFinalDocx({
      documentId: input.documentId,
      request: input.request,
      creatorName: doc.adminName || creatorName,
      creatorEmail: doc.adminEmail || creatorEmail,
      signedAt: doc.adminSignedAt || undefined,
    });
    const latest = await prisma.shmDocument.findUnique({
      where: { documentId: input.documentId },
      select: { agreementData: true },
    });
    await prisma.shmDocument.update({
      where: { documentId: input.documentId },
      data: {
        agreementData: mergeAgreementData(latest?.agreementData || doc.agreementData, {
          last_submission: result.regeneratedSubmission,
          landlord_stamped_docx_at: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    console.error("[landlord-approve] DOCX re-stamp failed", error);
    await logShmEvent(input.documentId, "landlord_approval_docx_stamp_failed", input.request);
  }

  if (!creatorEmail && !applicantEmail) {
    return {
      ok: true as const,
      status: 200,
      alreadyApproved,
      message:
        "Tenant approved, but creator and applicant emails were missing so approval notices could not be sent.",
    };
  }

  let notifications: Awaited<ReturnType<typeof sendLandlordApprovalNotifications>>;
  try {
    notifications = await sendLandlordApprovalNotifications({
      landlordName: landlord.name,
      landlordEmail: landlord.email,
      applicantName,
      applicantEmail: applicantEmail || undefined,
      propertyAddress: tenant.propertyAddress || doc.propertyAddress,
      documentId: doc.documentId,
      rentAmount: tenant.rent,
      creatorEmail: creatorEmail || undefined,
      creatorName,
    });
  } catch (error) {
    console.error("[landlord-approve] approval emails failed", error);
    await logShmEvent(input.documentId, "landlord_approval_emails_error", input.request);
    return {
      ok: true as const,
      status: 200,
      alreadyApproved,
      message: "Tenant approved, but sending confirmation emails failed. Please check email logs.",
    };
  }

  await logShmEvent(
    input.documentId,
    notifications.creator.ok
      ? "landlord_approval_creator_email_sent"
      : notifications.creator.skipped
        ? "landlord_approval_creator_email_skipped"
        : "landlord_approval_creator_email_error",
    input.request,
  );
  await logShmEvent(
    input.documentId,
    notifications.applicant.ok
      ? "landlord_approval_applicant_email_sent"
      : notifications.applicant.skipped
        ? "landlord_approval_applicant_email_skipped"
        : "landlord_approval_applicant_email_error",
    input.request,
  );

  const parts: string[] = [];
  if (notifications.creator.ok) parts.push("creator notified");
  else if (notifications.creator.skipped) parts.push(`creator skipped (${notifications.creator.message})`);
  else parts.push(`creator email failed (${notifications.creator.message})`);

  if (notifications.applicant.ok) parts.push("applicant notified");
  else if (notifications.applicant.skipped) parts.push(`applicant skipped (${notifications.applicant.message})`);
  else parts.push(`applicant email failed (${notifications.applicant.message})`);

  return {
    ok: true as const,
    status: 200,
    alreadyApproved,
    message: alreadyApproved
      ? `Already approved. Re-sent notices: ${parts.join("; ")}.`
      : `Tenant approved. ${parts.join("; ")}.`,
    emailResults: notifications,
  };
}
