import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { processLandlordWeeklyReportSendJob } from "../../../../../lib/shm/landlord-weekly-report-send-processor";
import { isLandlordWeeklyReport, logShmEvent, validateShmToken } from "../../../../../lib/shm/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : {};
  } catch {
    existing = {};
  }
  return JSON.stringify({ ...existing, ...patch });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "").trim();
  const token = String(body?.token || "").trim();
  const doc = await validateShmToken(docId, token);
  if (!doc || doc.adminToken !== token) {
    return NextResponse.json({ message: "Invalid admin signing link" }, { status: 403 });
  }
  if (!isLandlordWeeklyReport(doc.documentType)) {
    return NextResponse.json({ message: "This endpoint is only for Landlord Weekly Report documents." }, { status: 400 });
  }

  const landlordName = String(body?.landlord_name || body?.recipient_name || "").trim();
  const landlordEmail = String(body?.landlord_email || body?.recipient_email || "").trim().toLowerCase();
  const agreementData = (body?.agreement_data || body?.agreementData || {}) as Record<string, unknown>;

  if (!landlordName || !landlordEmail.includes("@")) {
    return NextResponse.json({ message: "Landlord name and email are required." }, { status: 400 });
  }

  const reportData = {
    ...agreementData,
    property_name: String(agreementData.property_name || doc.propertyAddress || "").trim(),
    landlord_name: landlordName,
    landlord_email: landlordEmail,
    report_date: String(agreementData.report_date || new Date().toISOString().slice(0, 10)),
  };

  await prisma.shmDocument.update({
    where: { documentId: doc.documentId },
    data: {
      status: "Sent",
      recipientName: landlordName,
      recipientEmail: landlordEmail,
      recipientRole: "Landlord",
      propertyAddress: String(reportData.property_name || doc.propertyAddress || ""),
      adminSignedAt: new Date(),
      sentAt: new Date(),
      tenantSentAt: new Date(),
      agreementData: mergeAgreementData(doc.agreementData, {
        ...reportData,
        lwr_send_payload: {
          landlord_name: landlordName,
          landlord_email: landlordEmail,
          report_data: reportData,
        },
        lwr_send_job: {
          status: "queued",
          queuedAt: new Date().toISOString(),
          message: "Preparing weekly report for delivery…",
        },
      }),
    },
  });

  await prisma.shmDocumentSigner.updateMany({
    where: { documentId: doc.documentId, signerType: "recipient" },
    data: {
      name: landlordName,
      email: landlordEmail,
      role: "Landlord",
      status: "Sent",
      sentAt: new Date(),
    },
  });

  await logShmEvent(doc.documentId, "landlord_weekly_report_send_queued", request);

  const result = await processLandlordWeeklyReportSendJob(doc.documentId, request);

  return NextResponse.json(
    {
      success: result.ok,
      accepted: true,
      queued: false,
      email_sent: result.emailSent ?? result.ok,
      message: result.message,
    },
    { status: result.ok ? 200 : 502 },
  );
}
