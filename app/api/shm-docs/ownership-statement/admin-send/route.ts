import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { dispatchOwnershipStatementSendJob } from "../../../../../lib/shm/background-jobs";
import { logShmEvent, validateShmToken } from "../../../../../lib/shm/documents";
import { getOwnershipStatementSendJob } from "../../../../../lib/shm/ownership-statement-send-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function collectAdminIdentity(agreementData: Record<string, unknown>, fallbackName?: string | null, fallbackEmail?: string | null) {
  const name = String(agreementData.provider_name || agreementData.admin_name || agreementData.manager_name || fallbackName || "Admin");
  const email = String(agreementData.provider_email || agreementData.admin_email || agreementData.manager_email || fallbackEmail || "");
  return { name, email };
}

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
}

function createJobId() {
  return randomBytes(12).toString("hex");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "").trim();
  const token = String(body?.token || "").trim();
  const doc = await validateShmToken(docId, token);
  if (!doc || doc.adminToken !== token) {
    return NextResponse.json({ message: "Invalid admin signing link" }, { status: 403 });
  }

  const ownerName = String(body?.owner_name || body?.recipient_name || "").trim();
  const ownerEmail = String(body?.owner_email || body?.recipient_email || "").trim();
  const adminSignature = String(body?.admin_signature || body?.signature || "").trim();
  const agreementData = (body?.agreement_data || body?.agreementData || {}) as Record<string, unknown>;
  const adminSignatureDate =
    String(body?.admin_signature_date || agreementData.generated_on || "").trim() ||
    new Date().toISOString().slice(0, 10);

  if (!ownerName || !ownerEmail) {
    return NextResponse.json({ message: "Owner name and email are required." }, { status: 400 });
  }

  const existingJob = getOwnershipStatementSendJob(doc.agreementData);
  if (existingJob && (existingJob.status === "queued" || existingJob.status === "processing")) {
    return NextResponse.json(
      {
        success: true,
        accepted: true,
        queued: true,
        job_id: existingJob.id,
        job_status: existingJob.status,
        message: "Your ownership statement is already being sent.",
      },
      { status: 202 },
    );
  }

  const adminIdentity = collectAdminIdentity(agreementData, doc.adminName, doc.adminEmail);
  const jobId = createJobId();
  const queuedAt = new Date().toISOString();
  const mergedAgreementData = mergeAgreementData(doc.agreementData, {
    ...agreementData,
    owner_name: ownerName,
    owner_email: ownerEmail,
    recipientRole: "Owner",
    recipientName: ownerName,
    recipientEmail: ownerEmail,
    admin_signature_date: adminSignatureDate,
    send_job: {
      id: jobId,
      status: "queued",
      queuedAt,
      message: "Preparing ownership statement for delivery...",
    },
    send_job_payload: {
      ownerName,
      ownerEmail,
      adminSignature,
      adminSignatureDate,
      agreementData,
      adminName: adminIdentity.name,
      adminEmail: adminIdentity.email,
    },
  });

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: {
      status: "Sent",
      recipientName: ownerName,
      recipientEmail: ownerEmail,
      recipientRole: "Owner",
      tenantName: ownerName,
      tenantEmail: ownerEmail,
      agreementData: mergedAgreementData,
      adminSignature,
      adminName: adminIdentity.name,
      adminEmail: adminIdentity.email,
      adminSignedAt: new Date(),
      sentAt: new Date(),
      tenantSentAt: new Date(),
    },
  });

  await prisma.shmDocumentSigner.updateMany({
    where: { documentId: doc.documentId, signerType: "creator" },
    data: {
      name: adminIdentity.name,
      email: adminIdentity.email,
      role: "Sender",
      status: "Sent",
      signature: adminSignature,
      signedAt: new Date(),
    },
  });

  await prisma.shmDocumentSigner.updateMany({
    where: { documentId: doc.documentId, signerType: "recipient" },
    data: {
      name: ownerName,
      email: ownerEmail,
      role: "Owner",
      status: "Sent",
      sentAt: new Date(),
    },
  });

  await logShmEvent(doc.documentId, "admin_signed", request);
  await logShmEvent(doc.documentId, "owner_statement_send_queued", request);

  dispatchOwnershipStatementSendJob(doc.documentId, jobId);

  return NextResponse.json(
    {
      success: true,
      accepted: true,
      queued: true,
      job_id: jobId,
      job_status: "queued",
      message: `Ownership statement is being sent to ${ownerEmail}.`,
    },
    { status: 202 },
  );
}
