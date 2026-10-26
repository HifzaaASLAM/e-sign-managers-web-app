import { prisma } from "../prisma";
import { logShmEvent } from "./documents";
import { generateLandlordWeeklyReportFile } from "./landlord-weekly-report-export";
import { sendLandlordWeeklyReportToLandlordEmail } from "./mailer";

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

export type LandlordWeeklyReportSendResult = {
  ok: boolean;
  message: string;
  emailSent?: boolean;
};

function reportDataFromDoc(doc: { agreementData: string | null; recipientName: string | null; recipientEmail: string | null; propertyAddress: string | null }) {
  const agreement = parseAgreementData(doc.agreementData);
  const payload = agreement.lwr_send_payload as Record<string, unknown> | undefined;
  const payloadReport = (payload?.report_data || {}) as Record<string, unknown>;

  const landlordName = String(
    payload?.landlord_name || payloadReport.landlord_name || agreement.landlord_name || doc.recipientName || "",
  ).trim();
  const landlordEmail = String(
    payload?.landlord_email || payloadReport.landlord_email || agreement.landlord_email || doc.recipientEmail || "",
  ).trim().toLowerCase();

  const reportData: Record<string, unknown> = {
    ...agreement,
    ...payloadReport,
    property_name: String(
      payloadReport.property_name || agreement.property_name || doc.propertyAddress || "",
    ).trim(),
    landlord_name: landlordName,
    landlord_email: landlordEmail,
  };

  for (const key of ["lwr_send_payload", "lwr_send_job", "send_job", "send_job_payload"]) {
    delete reportData[key];
  }

  return { landlordName, landlordEmail, reportData };
}

export async function processLandlordWeeklyReportSendJob(
  documentId: string,
  request?: Request,
): Promise<LandlordWeeklyReportSendResult> {
  const doc = await prisma.shmDocument.findUnique({ where: { documentId } });
  if (!doc) {
    return { ok: false, message: "Document not found." };
  }

  const { landlordName, landlordEmail, reportData } = reportDataFromDoc(doc);
  if (!landlordName || !landlordEmail.includes("@")) {
    return { ok: false, message: "Landlord name and email are required." };
  }

  try {
    const generated = await generateLandlordWeeklyReportFile(
      reportData,
      landlordName,
      String(reportData.report_date || ""),
    );

    const pdfBuffer = generated.pdf?.buffer?.length ? generated.pdf.buffer : generated.buffer;
    if (!pdfBuffer?.length) {
      throw new Error("Could not generate the weekly report PDF.");
    }

    const pdfFileName = generated.pdf?.fileName || generated.fileName;
    const pdfFileContent = pdfBuffer.toString("base64");

    const lastSubmission = {
      fileName: pdfFileName,
      fileType: "application/pdf",
      fileContent: pdfFileContent,
      pdfFileName,
      pdfFileType: "application/pdf",
      pdfFileContent,
      signedAt: new Date().toISOString(),
      source: "landlord-weekly-report-html.pdf",
    };

    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        recipientName: landlordName,
        recipientEmail: landlordEmail,
        recipientRole: "Landlord",
        propertyAddress: String(reportData.property_name || doc.propertyAddress || ""),
        adminSignedAt: new Date(),
        agreementData: mergeAgreementData(doc.agreementData, {
          ...reportData,
          last_submission: lastSubmission,
          lwr_send_job: {
            status: "processing",
            startedAt: new Date().toISOString(),
            message: "Sending weekly report email…",
          },
        }),
      },
    });

    await prisma.shmDocumentSigner.updateMany({
      where: { documentId, signerType: "recipient" },
      data: {
        name: landlordName,
        email: landlordEmail,
        role: "Landlord",
        status: "Sent",
        sentAt: new Date(),
      },
    });

    const emailResult = await sendLandlordWeeklyReportToLandlordEmail({
      to: landlordEmail,
      name: landlordName,
      documentId: doc.documentId,
      propertyAddress: String(reportData.property_name || doc.propertyAddress || ""),
      attachments: [
        {
          fileName: pdfFileName,
          fileContent: pdfFileContent,
          fileType: "application/pdf",
        },
      ],
    });

    const latest = await prisma.shmDocument.findUnique({ where: { documentId } });
    const completedAt = new Date().toISOString();

    if (emailResult.ok) {
      await prisma.shmDocument.update({
        where: { documentId },
        data: {
          status: "Sent",
          sentAt: new Date(),
          tenantSentAt: new Date(),
          agreementData: mergeAgreementData(latest?.agreementData || null, {
            lwr_send_job: {
              status: "completed",
              completedAt,
              emailStatus: "sent",
              message: `Weekly report sent to ${landlordEmail}.`,
            },
          }),
        },
      });
      await logShmEvent(documentId, "landlord_weekly_report_sent", request);
      return {
        ok: true,
        emailSent: true,
        message: `Weekly report sent to ${landlordEmail}.`,
      };
    }

    const emailMessage = emailResult.message || "Email could not be sent.";
    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        status: "Sent",
        agreementData: mergeAgreementData(latest?.agreementData || null, {
          lwr_send_job: {
            status: "failed",
            completedAt,
            emailStatus: emailResult.skipped ? "skipped" : "error",
            error: emailMessage,
            message: emailMessage,
          },
        }),
      },
    });
    await logShmEvent(documentId, "landlord_weekly_report_send_error", request);
    return {
      ok: false,
      emailSent: false,
      message: emailMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed";
    const latest = await prisma.shmDocument.findUnique({ where: { documentId } });
    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        status: "Make Error",
        agreementData: mergeAgreementData(latest?.agreementData || null, {
          lwr_send_job: {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: message,
            message,
          },
        }),
      },
    });
    await logShmEvent(documentId, "landlord_weekly_report_send_error", request);
    return { ok: false, message };
  }
}

/** @deprecated Use processLandlordWeeklyReportSendJob directly from admin-send. */
export function dispatchLandlordWeeklyReportSendJob(documentId: string) {
  void processLandlordWeeklyReportSendJob(documentId).catch((error) => {
    console.error("[landlord-weekly-report] send job failed", error);
  });
}
