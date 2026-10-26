import { prisma } from "../prisma";
import { isTenantAgreement, logShmEvent } from "./documents";
import { sendTenantAgreementTenantSignedNotificationEmail } from "./mailer";
import { buildTenantAgreementTenantSignedNotificationAttachment } from "./tenant-agreement-email-attachments";

function parseAgreementData(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** After tenant signs a Tenant Agreement: notify SHM inbox (no property-manager auto-sign). */
export async function runTenantAgreementPostTenantSignWorkflow(input: {
  documentId: string;
  fileName: string;
  fileContent: string;
  fileType: string;
  token: string;
  request?: Request;
}) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId: input.documentId },
    include: { signers: true },
  });
  if (!doc || !isTenantAgreement(doc.documentType)) return;

  const agreementData = parseAgreementData(doc.agreementData);
  if (!agreementData.tenant_signed_info_email_sent_at) {
    const tenantSignature = doc.tenantSignature || "";
    const attachments = await buildTenantAgreementTenantSignedNotificationAttachment({
      documentId: doc.documentId,
      agreementData,
      tenantSignature,
      propertyAddress: doc.propertyAddress,
      tenantName: doc.recipientName || doc.tenantName,
      tenantEmail: doc.recipientEmail || doc.tenantEmail,
      adminSignature: doc.adminSignature,
      submittedFile: input.fileContent
        ? {
            fileName: input.fileName,
            fileContent: input.fileContent,
            fileType: input.fileType,
          }
        : undefined,
    });

    const emailResult = await sendTenantAgreementTenantSignedNotificationEmail({
      documentId: doc.documentId,
      tenantName: doc.recipientName || doc.tenantName || "Tenant",
      tenantEmail: doc.recipientEmail || doc.tenantEmail || "",
      propertyAddress: doc.propertyAddress,
      attachments,
    });

    const eventSuffix = emailResult.ok
      ? "sent"
      : emailResult.skipped
        ? "skipped"
        : "error";

    await logShmEvent(
      doc.documentId,
      `tenant_agreement_tenant_signed_info_email_${eventSuffix}`,
      input.request,
    );

    if (emailResult.ok) {
      const latest = await prisma.shmDocument.findUnique({
        where: { documentId: doc.documentId },
        select: { agreementData: true },
      });
      const merged = parseAgreementData(latest?.agreementData || doc.agreementData);
      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: {
          agreementData: JSON.stringify({
            ...merged,
            tenant_signed_info_email_sent_at: new Date().toISOString(),
          }),
        },
      });
    }
  }

}
