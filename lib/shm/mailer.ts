import { Resend } from "resend";
import { prisma } from "../prisma";
import { ensureAdminDocumentDownloadUrl } from "./admin-document-download";
import { getAppUrl, isTenantApplication } from "./documents";
import { formatRentDisplay } from "./tenant-application-prefill";
import {
  renderSigningEmailHtml,
  resolveSigningEmailSubject,
  type SigningEmailStoredContent,
} from "./signing-email-templates";

export type SigningEmailResult = {
  ok: boolean;
  skipped: boolean;
  message?: string;
  resendId?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveFromAddress() {
  const raw = (process.env.EMAIL_FROM || process.env.NEXT_PUBLIC_EMAIL_FROM || "").trim();
  if (!raw) return null;

  if (raw.includes("<") && raw.includes(">")) return raw;

  const name = (process.env.EMAIL_FROM_NAME || "ShareHouseManagers").trim();
  return `${name} <${raw}>`;
}

async function logEmailAttempt(input: {
  to: string;
  subject: string;
  type: string;
  status: string;
  documentId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.emailLog.create({
      data: {
        to: input.to,
        subject: input.subject,
        type: input.type,
        status: input.status,
        metadata: JSON.stringify({
          documentId: input.documentId,
          ...input.metadata,
        }),
      },
    });
  } catch {
    // Non-blocking if log table is unavailable
  }
}

export async function sendOwnershipStatementToOwnerEmail(input: {
  to: string;
  name: string;
  documentId: string;
  documentType: string;
  propertyAddress?: string;
  fileName?: string;
  fileContent?: string;
  fileType?: string;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
  viewToken?: string;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({
      to,
      subject: `Your ${input.documentType}`,
      type: "shm_ownership_statement_sent",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set. Use a verified domain address, e.g. noreply@yourdomain.com";
    await logEmailAttempt({
      to,
      subject: `Your ${input.documentType}`,
      type: "shm_ownership_statement_sent",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const fromAddress = from;
  const resend = new Resend(apiKey);
  const subject = `Your ${input.documentType} is ready`;
  const name = escapeHtml(input.name || "there");
  const type = escapeHtml(input.documentType);
  const documentId = escapeHtml(input.documentId);
  const address = escapeHtml((input.propertyAddress || "").trim());
  const propertyBlock = address
    ? `<p style="background:#f5f5f5;padding:12px 16px;border-radius:5px;font-weight:600;">${address}</p>`
    : "";

  const attachmentList = (input.attachments?.length
    ? input.attachments
  : input.fileContent
    ? [{ fileName: input.fileName || "", fileContent: input.fileContent, fileType: input.fileType || "" }]
    : [])
    .map((item) => ({
      fileName: item.fileName,
      fileContent: item.fileContent.replace(/^data:[^;]+;base64,/, ""),
      fileType: item.fileType,
    }))
    .filter((item) => item.fileName && item.fileContent);

  const hasPdfAttachment = attachmentList.some((item) =>
    item.fileType === "application/pdf" || item.fileName.toLowerCase().endsWith(".pdf"),
  );
  const hasDocxAttachment = attachmentList.some((item) =>
    item.fileType.includes("wordprocessingml") || item.fileName.toLowerCase().endsWith(".docx"),
  );

  const attachmentMessage = hasPdfAttachment && hasDocxAttachment
    ? "The statement is attached as a PDF for easy viewing in email, and as a Word document (.docx) for the full original layout."
    : hasPdfAttachment
      ? "The completed statement is attached to this email as a PDF for your records. No signature is required from you."
      : hasDocxAttachment
        ? "The completed statement is attached as a Word document (.docx). If your email preview looks distorted, download the file and open it in Microsoft Word."
        : "The completed statement is attached to this email for your records. No signature is required from you.";

  const viewToken = String(input.viewToken || "").trim();
  const viewUrl = viewToken
    ? `${getAppUrl()}/api/shm-docs/ownership-statement/email-opened?doc_id=${encodeURIComponent(input.documentId)}&token=${encodeURIComponent(viewToken)}`
    : "";
  const viewBlock = viewUrl
    ? `<div style="text-align:center;margin:24px 0;">
        <a href="${viewUrl}" style="background:#1677ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">View Statement Online</a>
      </div>
      <p style="font-size:12px;color:#64748b;text-align:center;">Opening this email or clicking the button confirms receipt.</p>`
    : "";
  const trackingPixel = viewUrl
    ? `<img src="${viewUrl}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`
    : "";

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:28px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${name},</p>
        <p>Your <strong>${type}</strong> has been prepared and signed by your property manager.</p>
        ${propertyBlock}
        <p>${attachmentMessage}</p>
        ${viewBlock}
        <p style="font-size:12px;color:#999;line-height:1.6;">
          Document ID: ${documentId}<br>
          If you did not expect this email, please contact us.
        </p>
      </div>
      ${trackingPixel}
    </body></html>`;

  const maxAttachmentBytes = 35 * 1024 * 1024;
  const preparedAttachments = attachmentList
    .map((item) => {
      const bytes = Buffer.from(item.fileContent, "base64").length;
      return {
        filename: item.fileName,
        content: Buffer.from(item.fileContent, "base64"),
        contentType: item.fileType || (item.fileName.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : item.fileName.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream"),
        bytes,
      };
    })
    .filter((item) => item.bytes > 0 && item.bytes <= maxAttachmentBytes);

  const canAttach = preparedAttachments.length > 0;

  async function attemptSend(includeAttachment: boolean): Promise<SigningEmailResult> {
    const htmlBody = includeAttachment
      ? html
      : html.replace(
          "The completed statement is attached to this email for your records.",
          "Your completed ownership statement has been prepared and is being saved to your records.",
        );

    const attachments = includeAttachment && canAttach
      ? preparedAttachments.map(({ filename, content, contentType }) => ({
          filename,
          content,
          contentType,
        }))
      : undefined;

    try {
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to,
        subject,
        html: htmlBody,
        attachments,
        headers: {
          "X-Entity-Ref-ID": input.documentId || "shm-ownership-statement",
        },
      });

      if (error) {
        const message = error.message || "Resend rejected the email.";
        await logEmailAttempt({
          to,
          subject,
          type: "shm_ownership_statement_sent",
          status: "error",
          documentId: input.documentId,
          metadata: { error: message, includeAttachment },
        });
        return { ok: false, skipped: false, message };
      }

      await logEmailAttempt({
        to,
        subject,
        type: "shm_ownership_statement_sent",
        status: "sent",
        documentId: input.documentId,
        metadata: { resendId: data?.id, includeAttachment },
      });

      return { ok: true, skipped: false, resendId: data?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email send failed.";
      await logEmailAttempt({
        to,
        subject,
        type: "shm_ownership_statement_sent",
        status: "error",
        documentId: input.documentId,
        metadata: { error: message, includeAttachment },
      });
      return { ok: false, skipped: false, message };
    }
  }

  let result = await attemptSend(true);
  if (!result.ok && canAttach) {
    result = await attemptSend(false);
  }
  return result;
}

export async function sendLandlordWeeklyReportToLandlordEmail(input: {
  to: string;
  name: string;
  documentId: string;
  propertyAddress?: string;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const documentType = "Landlord Weekly Report";

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({
      to,
      subject: `Your ${documentType}`,
      type: "shm_landlord_weekly_report_sent",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set. Use a verified domain address, e.g. noreply@yourdomain.com";
    await logEmailAttempt({
      to,
      subject: `Your ${documentType}`,
      type: "shm_landlord_weekly_report_sent",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const pdfOnly = (input.attachments || []).filter(
    (item) =>
      item.fileType === "application/pdf" || item.fileName.toLowerCase().endsWith(".pdf"),
  );
  const attachmentList = pdfOnly.length ? pdfOnly : input.attachments || [];

  const name = escapeHtml(input.name || "there");
  const documentId = escapeHtml(input.documentId);
  const address = escapeHtml((input.propertyAddress || "").trim());
  const propertyBlock = address
    ? `<p style="background:#f5f5f5;padding:12px 16px;border-radius:5px;font-weight:600;">${address}</p>`
    : "";

  const preparedAttachments = prepareSigningEmailAttachments(attachmentList);
  const subject = input.propertyAddress
    ? `Weekly Property Report — ${input.propertyAddress}`
    : "Your Weekly Property Report";
  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:28px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${name},</p>
        <p>Please find attached your <strong>Weekly Landlord Update</strong> for the reporting period.</p>
        ${propertyBlock}
        <p>The report is attached as a PDF. No signature or action is required on your side.</p>
        <p style="font-size:12px;color:#999;line-height:1.6;">
          Document ID: ${documentId}<br>
          If you did not expect this email, please contact us.
        </p>
      </div>
    </body></html>`;

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    attachments: preparedAttachments.map((item) => ({
      filename: item.filename,
      content: item.content,
      contentType: item.contentType,
    })),
  });

  if (result.error) {
    await logEmailAttempt({
      to,
      subject,
      type: "shm_landlord_weekly_report_sent",
      status: "error",
      documentId: input.documentId,
      metadata: { error: result.error.message },
    });
    return { ok: false, message: result.error.message };
  }

  await logEmailAttempt({
    to,
    subject,
    type: "shm_landlord_weekly_report_sent",
    status: "sent",
    documentId: input.documentId,
  });
  return { ok: true };
}

function prepareSigningEmailAttachments(
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>,
) {
  const maxAttachmentBytes = 35 * 1024 * 1024;
  return (attachments || [])
    .map((item) => {
      const content = item.fileContent.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(content, "base64").length;
      const fileName = item.fileName || "document.docx";
      const lower = fileName.toLowerCase();
      const contentType =
        item.fileType
        || (lower.endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : lower.endsWith(".pdf")
            ? "application/pdf"
            : "application/octet-stream");
      return {
        filename: fileName,
        content: Buffer.from(content, "base64"),
        contentType,
        bytes,
      };
    })
    .filter((item) => item.bytes > 0 && item.bytes <= maxAttachmentBytes);
}

export async function sendSigningEmail(input: {
  to: string;
  name: string;
  documentType: string;
  signingUrl: string;
  propertyAddress?: string;
  documentId?: string;
  /** Creator/admin email — receives “signing email sent” acknowledgment. */
  creatorEmail?: string | null;
  creatorName?: string | null;
  /** CC recipients (copy only, no separate signing link). */
  cc?: string[];
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
  signingEmail?: SigningEmailStoredContent;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({
      to,
      subject: `Sign your ${input.documentType}`,
      type: "shm_signing_link",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set. Use a verified domain address, e.g. noreply@yourdomain.com";
    await logEmailAttempt({
      to,
      subject: `Sign your ${input.documentType}`,
      type: "shm_signing_link",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const signingUrl = input.signingUrl;

  const preparedAttachments = prepareSigningEmailAttachments(input.attachments);
  const hasDocxAttachment = preparedAttachments.some((item) =>
    item.filename.toLowerCase().endsWith(".docx")
    || item.contentType.includes("wordprocessingml"),
  );

  const subject = resolveSigningEmailSubject({
    documentType: input.documentType,
    recipientName: input.name,
    recipientEmail: to,
    signingUrl,
    propertyAddress: input.propertyAddress,
    documentId: input.documentId,
    subject: input.signingEmail?.subject,
    body: input.signingEmail?.body,
  });

  const html = renderSigningEmailHtml({
    documentType: input.documentType,
    recipientName: input.name,
    recipientEmail: to,
    signingUrl,
    propertyAddress: input.propertyAddress,
    documentId: input.documentId,
    subject: input.signingEmail?.subject,
    body: input.signingEmail?.body,
    hasDocxAttachment,
    hasAnyAttachment: preparedAttachments.length > 0,
  });

  const htmlWithoutAttachmentNote = html.replace(
    /<p style="margin:0 0 16px;font-size:15px;line-height:1\.6;color:#5B5B5B;">[\s\S]*?Please complete your signature online using the button below\.<\/p>/g,
    "",
  );

  async function attemptSend(includeAttachment: boolean): Promise<SigningEmailResult> {
    const htmlBody = includeAttachment ? html : htmlWithoutAttachmentNote;

    const attachments = includeAttachment && preparedAttachments.length
      ? preparedAttachments.map(({ filename, content, contentType }) => ({
          filename,
          content,
          contentType,
        }))
      : undefined;

    try {
      const cc =
        input.cc?.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@") && e !== to) || [];
      const { data, error } = await resend.emails.send({
        from,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        html: htmlBody,
        attachments,
        headers: {
          "X-Entity-Ref-ID": input.documentId || "shm-signing",
        },
      });

      if (error) {
        const message = error.message || "Resend rejected the email.";
        await logEmailAttempt({
          to,
          subject,
          type: "shm_signing_link",
          status: "error",
          documentId: input.documentId,
          metadata: { error: message, includeAttachment },
        });
        return { ok: false, skipped: false, message };
      }

      await logEmailAttempt({
        to,
        subject,
        type: "shm_signing_link",
        status: "sent",
        documentId: input.documentId,
        metadata: { resendId: data?.id, includeAttachment },
      });

      void sendSigningEmailSentAcknowledgment({
        documentId: input.documentId || "",
        documentType: input.documentType,
        propertyAddress: input.propertyAddress,
        recipientName: input.name,
        recipientEmail: to,
        creatorEmail: input.creatorEmail,
        creatorName: input.creatorName,
      });

      return { ok: true, skipped: false, resendId: data?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email send failed.";
      await logEmailAttempt({
        to,
        subject,
        type: "shm_signing_link",
        status: "error",
        documentId: input.documentId,
        metadata: { error: message, includeAttachment },
      });
      return { ok: false, skipped: false, message };
    }
  }

  let result = preparedAttachments.length > 0 ? await attemptSend(true) : await attemptSend(false);
  if (!result.ok && preparedAttachments.length > 0) {
    result = await attemptSend(false);
  }
  return result;
}

/** PMA CC recipients — view-only link, no signing request. */
export async function sendPmaDocumentViewOnlyEmail(input: {
  to: string;
  name: string;
  documentType: string;
  documentId: string;
  propertyAddress?: string;
  viewUrl: string;
  role?: string;
  primarySignerName?: string;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const documentType = String(input.documentType || "Property Management Agreement").trim();
  const subject = `For your information — ${documentType}`;

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_pma_view_copy",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set. Use a verified domain address, e.g. noreply@yourdomain.com";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_pma_view_copy",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const name = escapeHtml(input.name || "there");
  const type = escapeHtml(documentType);
  const address = escapeHtml((input.propertyAddress || "").trim());
  const role = escapeHtml(String(input.role || "").trim());
  const signerName = escapeHtml(String(input.primarySignerName || "").trim());
  const viewUrl = escapeHtml(input.viewUrl);
  const propertyBlock = address
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5B5B5B;">Property: <strong style="color:#1C1C1C;">${address}</strong></p>`
    : "";
  const roleLine = role
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5B5B5B;">You are copied as: <strong>${role}</strong>.</p>`
    : "";
  const signerLine = signerName
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5B5B5B;">The owner/signatory (${signerName}) will complete signing separately. <strong>You do not need to sign.</strong></p>`
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#5B5B5B;"><strong>You do not need to sign.</strong> This copy is for your records and review only.</p>`;

  const html = `
    <html><body style="font-family:Calibri,Arial,sans-serif;color:#1C1C1C;max-width:600px;margin:0 auto;background:#F4F4F4;padding:24px;">
      <div style="background:#fff;padding:32px;border:1px solid #E6E7E8;border-radius:8px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Dear ${name},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">ShareHouseManagers has sent you a copy of the <strong>${type}</strong> for your information.</p>
        ${propertyBlock}
        ${roleLine}
        ${signerLine}
        <div style="text-align:center;margin:28px 0;">
          <a href="${viewUrl}" style="background:#1C1C1C;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">View document</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5B5B5B;">This link lets you open the agreement in your browser. It does not request a signature from you.</p>
        <p style="margin:16px 0 0;font-size:12px;color:#999;line-height:1.6;">Document ID: ${escapeHtml(input.documentId)}</p>
      </div>
    </body></html>`;

  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: {
        "X-Entity-Ref-ID": input.documentId || "shm-pma-view",
      },
    });

    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({
        to,
        subject,
        type: "shm_pma_view_copy",
        status: "error",
        documentId: input.documentId,
        metadata: { error: message },
      });
      return { ok: false, skipped: false, message };
    }

    await logEmailAttempt({
      to,
      subject,
      type: "shm_pma_view_copy",
      status: "sent",
      documentId: input.documentId,
      metadata: { resendId: data?.id },
    });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_pma_view_copy",
      status: "error",
      documentId: input.documentId,
      metadata: { error: message },
    });
    return { ok: false, skipped: false, message };
  }
}


async function sendSigningEmailSentAcknowledgment(input: {
  documentId: string;
  documentType: string;
  propertyAddress?: string;
  recipientName: string;
  recipientEmail: string;
  creatorEmail?: string | null;
  creatorName?: string | null;
}): Promise<SigningEmailResult> {
  const ackTo = String(input.creatorEmail || "").trim().toLowerCase();
  if (!ackTo) return { ok: false, skipped: true, message: "Creator email is not available for acknowledgment." };

  return sendAdminNotificationEmail({
    to: ackTo,
    adminName: input.creatorName || "Creator",
    subject: `Signing email sent — ${input.documentType}${input.documentId ? ` (${input.documentId})` : ""}`,
    heading: "Signing email sent",
    intro: "This confirms that a signing request email was successfully delivered to the recipient below.",
    documentId: input.documentId,
    documentType: input.documentType,
    propertyAddress: input.propertyAddress,
    signerName: input.recipientName,
    signerEmail: input.recipientEmail,
    signerLabel: "Sent to",
    emailType: "shm_signing_link_sent_ack",
  });
}

export function resolveTenantAgreementTenantSignedNotifyEmail() {
  return (process.env.TA_TENANT_SIGNED_NOTIFY_EMAIL || "info@sharehousemanagers.com.au").trim().toLowerCase();
}

export async function sendTenantAgreementTenantSignedNotificationEmail(input: {
  documentId: string;
  tenantName: string;
  tenantEmail: string;
  propertyAddress?: string | null;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
}): Promise<SigningEmailResult> {
  const to = resolveTenantAgreementTenantSignedNotifyEmail();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();

  const subject = `Tenant Agreement signed — ${input.tenantName}`;
  const emailType = "shm_tenant_agreement_tenant_signed_info";

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set.";
    await logEmailAttempt({ to, subject, type: emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }
  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({ to, subject, type: emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const name = escapeHtml(input.tenantName || "Tenant");
  const email = escapeHtml(input.tenantEmail || "");
  const property = escapeHtml(String(input.propertyAddress || "").trim() || "Not provided");
  const docId = escapeHtml(input.documentId);
  const dashboardUrl = `${getAppUrl()}/dashboard/documents/${encodeURIComponent(input.documentId)}`;
  const preparedAttachments = prepareSigningEmailAttachments(input.attachments);
  const attachmentNote = preparedAttachments.length
    ? "The tenant-signed agreement is attached to this email."
    : "The signed agreement file could not be attached; open the dashboard to download the document.";

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">Tenant Agreement signed</h2>
        <p style="line-height:1.6;margin:0 0 18px;">A tenant has completed signing their Tenant Agreement. ${escapeHtml(attachmentNote)}</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Tenant:</strong> ${name}</p>
          <p style="margin:0 0 8px;"><strong>Email:</strong> ${email || "Not provided"}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0;"><strong>Document ID:</strong> ${docId}</p>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${dashboardUrl}" style="background:#1677ff;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Open in dashboard</a>
        </div>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0;">Automated notification from the SHM signing system.</p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      attachments: preparedAttachments.length
        ? preparedAttachments.map(({ filename, content, contentType }) => ({
            filename,
            content,
            contentType,
          }))
        : undefined,
      headers: { "X-Entity-Ref-ID": input.documentId || "shm-tenant-agreement-tenant-signed" },
    });

    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject, type: emailType, status: "error", documentId: input.documentId, metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }

    await logEmailAttempt({
      to,
      subject,
      type: emailType,
      status: "sent",
      documentId: input.documentId,
      metadata: { resendId: data?.id, tenantEmail: input.tenantEmail, attachmentCount: preparedAttachments.length },
    });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject, type: emailType, status: "error", documentId: input.documentId, metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}

export async function sendTenantApplicationSignedNotification(input: {
  documentId: string;
  applicantName: string;
  applicantEmail: string;
  propertyAddress?: string | null;
  rentAmount?: unknown;
  creatorEmail?: string | null;
  creatorName?: string | null;
}): Promise<SigningEmailResult> {
  const ackTo = String(input.creatorEmail || "").trim().toLowerCase();
  if (!ackTo) {
    return { ok: false, skipped: true, message: "Creator email is not available for notification." };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  if (!apiKey) {
    const message = "RESEND_API_KEY is not set.";
    await logEmailAttempt({
      to: ackTo,
      subject: "Tenant Application signed",
      type: "shm_tenant_application_signed",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }
  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({
      to: ackTo,
      subject: "Tenant Application signed",
      type: "shm_tenant_application_signed",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const subject = `Tenant Application signed — ${input.applicantName}`;
  const creatorName = escapeHtml(input.creatorName || "Creator");
  const name = escapeHtml(input.applicantName || "Applicant");
  const email = escapeHtml(input.applicantEmail || "");
  const property = escapeHtml(String(input.propertyAddress || "").trim() || "Not provided");
  const rent = escapeHtml(formatRentDisplay(input.rentAmount));
  const docId = escapeHtml(input.documentId);
  const dashboardUrl = `${getAppUrl()}/dashboard/documents/${encodeURIComponent(input.documentId)}`;

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${creatorName},</p>
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">Rental application signed</h2>
        <p style="line-height:1.6;margin:0 0 18px;">The applicant below has completed and signed their tenant application.</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Name:</strong> ${name}</p>
          <p style="margin:0 0 8px;"><strong>Email:</strong> ${email || "Not provided"}</p>
          <p style="margin:0 0 8px;"><strong>Property address:</strong> ${property}</p>
          <p style="margin:0 0 8px;"><strong>Rent:</strong> ${rent}</p>
          <p style="margin:0;"><strong>Document ID:</strong> ${docId}</p>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${dashboardUrl}" style="background:#1677ff;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">View Application</a>
        </div>
        <p style="font-size:12px;color:#64748b;line-height:1.6;margin:0;">This is an automated notification from the SHM document signing system.</p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: ackTo,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId || "shm-tenant-application-signed" },
    });

    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({
        to: ackTo,
        subject,
        type: "shm_tenant_application_signed",
        status: "error",
        documentId: input.documentId,
        metadata: { error: message },
      });
      return { ok: false, skipped: false, message };
    }

    await logEmailAttempt({
      to: ackTo,
      subject,
      type: "shm_tenant_application_signed",
      status: "sent",
      documentId: input.documentId,
      metadata: { resendId: data?.id, applicantEmail: input.applicantEmail },
    });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({
      to: ackTo,
      subject,
      type: "shm_tenant_application_signed",
      status: "error",
      documentId: input.documentId,
      metadata: { error: message },
    });
    return { ok: false, skipped: false, message };
  }
}

export async function sendTenantApplicationApprovedEmail(input: {
  to: string;
  name: string;
  documentId: string;
  propertyAddress?: string;
  landlordName?: string;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = "Your Tenant Application has been approved";

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_tenant_application_approved",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }
  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_tenant_application_approved",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const name = escapeHtml(input.name || "Applicant");
  const property = escapeHtml(String(input.propertyAddress || "").trim());
  const propertyBlock = property
    ? `<p style="background:#f5f5f5;padding:12px 16px;border-radius:5px;font-weight:600;margin:16px 0;">${property}</p>`
    : "";
  const landlordLine = input.landlordName
    ? `<p>Your application has been <strong>approved by the landlord</strong> (${escapeHtml(input.landlordName)}).</p>`
    : `<p>We are pleased to confirm that your application has been <strong>successfully signed and approved</strong>.</p>`;

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:28px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${name},</p>
        <p>Thank you for submitting your <strong>Tenant Application</strong>.</p>
        ${landlordLine}
        ${propertyBlock}
        <p style="font-size:14px;line-height:1.6;color:#475569;">Our team will be in touch if any further information is required. If you have questions, please contact us at <a href="mailto:info@sharehousemanagers.com.au" style="color:#1677ff;">info@sharehousemanagers.com.au</a>.</p>
        <p style="font-size:12px;color:#999;line-height:1.6;margin-top:24px;">
          Document ID: ${escapeHtml(input.documentId)}<br>
          This is an automated confirmation from ShareHouseManagers.
        </p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId || "shm-tenant-application-approved" },
    });

    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({
        to,
        subject,
        type: "shm_tenant_application_approved",
        status: "error",
        documentId: input.documentId,
        metadata: { error: message },
      });
      return { ok: false, skipped: false, message };
    }

    await logEmailAttempt({
      to,
      subject,
      type: "shm_tenant_application_approved",
      status: "sent",
      documentId: input.documentId,
      metadata: { resendId: data?.id },
    });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_tenant_application_approved",
      status: "error",
      documentId: input.documentId,
      metadata: { error: message },
    });
    return { ok: false, skipped: false, message };
  }
}

export function resolveTenantApplicationFinalNotifyEmail() {
  return (process.env.TENANT_APPLICATION_FINAL_NOTIFY_EMAIL || "info@sharehousemanagers.com.au")
    .trim()
    .toLowerCase();
}

type TenantApplicationFinalEmailInput = {
  documentId: string;
  propertyAddress?: string | null;
  applicantName?: string | null;
  applicantEmail?: string | null;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
};

function renderTenantApplicationFinalEmailHtml(input: {
  greetingName: string;
  heading: string;
  intro: string;
  documentId: string;
  propertyAddress?: string | null;
  applicantName?: string | null;
  applicantEmail?: string | null;
  hasAttachment: boolean;
}) {
  const docId = escapeHtml(input.documentId);
  const property = escapeHtml(String(input.propertyAddress || "").trim() || "Not specified");
  const applicant = escapeHtml(input.applicantName || "Applicant");
  const applicantEmail = escapeHtml(input.applicantEmail || "");
  const attachmentNote = input.hasAttachment
    ? `<p style="line-height:1.6;margin:0 0 14px;">Your signed Tenant Application is attached to this email for your records.</p>`
    : `<p style="line-height:1.6;margin:0 0 14px;">We could not attach the document to this email; please contact us if you need a copy.</p>`;

  return `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${escapeHtml(input.greetingName)},</p>
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">${escapeHtml(input.heading)}</h2>
        <p style="line-height:1.6;">${escapeHtml(input.intro)}</p>
        ${attachmentNote}
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Document ID:</strong> ${docId}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0;"><strong>Applicant:</strong> ${applicant}${applicantEmail ? ` (${applicantEmail})` : ""}</p>
        </div>
        <p style="font-size:12px;color:#64748b;line-height:1.6;">If you have questions, contact us at <a href="mailto:info@sharehousemanagers.com.au" style="color:#1677ff;">info@sharehousemanagers.com.au</a>.</p>
      </div>
    </body></html>`;
}

/** Applicant — final Tenant Application after creator auto-signature (PDF attached). */
export async function sendTenantApplicationFinalApplicantEmail(
  input: TenantApplicationFinalEmailInput & { to: string; name?: string | null },
) {
  const property = String(input.propertyAddress || "").trim();
  const subject = property
    ? `Your signed Tenant Application — ${property}`
    : `Your signed Tenant Application — ${input.documentId}`;
  const html = renderTenantApplicationFinalEmailHtml({
    greetingName: input.name || input.applicantName || "Applicant",
    heading: "Your application is signed by ShareHouseManagers",
    intro:
      "Thank you for completing your Tenant Application. ShareHouseManagers has signed as the rental provider. Please keep the attached copy for your records.",
    documentId: input.documentId,
    propertyAddress: input.propertyAddress,
    applicantName: input.applicantName,
    applicantEmail: input.applicantEmail,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to: input.to,
    subject,
    html,
    documentId: input.documentId,
    emailType: "shm_tenant_application_final_applicant",
    attachments: input.attachments,
  });
}

/** Internal copy for info@ after creator auto-signature on Tenant Application. */
export async function sendTenantApplicationFinalInfoEmail(input: TenantApplicationFinalEmailInput) {
  const to = resolveTenantApplicationFinalNotifyEmail();
  const property = String(input.propertyAddress || "").trim();
  const subject = `Tenant Application creator signed — ${input.documentId}${property ? ` — ${property}` : ""}`;
  const html = renderTenantApplicationFinalEmailHtml({
    greetingName: "Team",
    heading: "Tenant Application — creator signature applied",
    intro:
      "The applicant signed and ShareHouseManagers auto-signed as creator. A PDF copy of the stamped application is attached for filing.",
    documentId: input.documentId,
    propertyAddress: input.propertyAddress,
    applicantName: input.applicantName,
    applicantEmail: input.applicantEmail,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to,
    subject,
    html,
    documentId: input.documentId,
    emailType: "shm_tenant_application_final_info",
    attachments: input.attachments,
  });
}

export async function sendLandlordApplicationSentNotice(input: {
  to: string;
  landlordName: string;
  applicantName: string;
  applicantEmail: string;
  propertyAddress?: string;
  documentId: string;
  rentAmount?: unknown;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = `Tenant Application sent for review — ${input.applicantName}`;

  if (!apiKey || !from) {
    const message = !apiKey ? "RESEND_API_KEY is not set." : "EMAIL_FROM is not set.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_landlord_application_sent",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const landlordName = escapeHtml(input.landlordName || "Landlord");
  const applicantName = escapeHtml(input.applicantName);
  const applicantEmail = escapeHtml(input.applicantEmail);
  const property = escapeHtml(String(input.propertyAddress || "").trim() || "Not specified");
  const rent = escapeHtml(formatRentDisplay(input.rentAmount));

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${landlordName},</p>
        <p style="line-height:1.6;">This is to formally advise that a <strong>Tenant Application</strong> has been issued through ShareHouseManagers for your property.</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Applicant:</strong> ${applicantName}</p>
          <p style="margin:0 0 8px;"><strong>Applicant email:</strong> ${applicantEmail}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0 0 8px;"><strong>Rent:</strong> ${rent}</p>
          <p style="margin:0;"><strong>Document ID:</strong> ${escapeHtml(input.documentId)}</p>
        </div>
        <p style="line-height:1.6;color:#475569;">Once the applicant has completed and signed the application, and ShareHouseManagers has processed it, you will receive a secure link to review the applicant details and approve the tenant.</p>
        <p style="font-size:12px;color:#64748b;margin-top:24px;">This is an automated notice from ShareHouseManagers.</p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId },
    });
    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject, type: "shm_landlord_application_sent", status: "error", documentId: input.documentId, metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }
    await logEmailAttempt({ to, subject, type: "shm_landlord_application_sent", status: "sent", documentId: input.documentId, metadata: { resendId: data?.id } });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject, type: "shm_landlord_application_sent", status: "error", documentId: input.documentId, metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}

export async function sendLandlordReviewInviteEmail(input: {
  to: string;
  landlordName: string;
  applicantName: string;
  propertyAddress?: string;
  documentId: string;
  reviewUrl: string;
  rentAmount?: unknown;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = `Action required: Review & approve tenant — ${input.applicantName}`;

  if (!apiKey || !from) {
    const message = !apiKey ? "RESEND_API_KEY is not set." : "EMAIL_FROM is not set.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_landlord_review_invite",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const landlordName = escapeHtml(input.landlordName || "Landlord");
  const applicantName = escapeHtml(input.applicantName);
  const property = escapeHtml(String(input.propertyAddress || "").trim() || "Not specified");
  const rent = escapeHtml(formatRentDisplay(input.rentAmount));

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${landlordName},</p>
        <p style="line-height:1.6;">The Tenant Application for <strong>${applicantName}</strong> has been completed and signed. ShareHouseManagers has processed the document and now invites you to formally review and approve this applicant.</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Applicant:</strong> ${applicantName}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0 0 8px;"><strong>Rent:</strong> ${rent}</p>
          <p style="margin:0;"><strong>Document ID:</strong> ${escapeHtml(input.documentId)}</p>
        </div>
        <p style="line-height:1.6;">Please open the secure review page to view the applicant details. If you are satisfied, select <strong>Approve the tenant</strong>.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${input.reviewUrl}" style="background:#1677ff;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">Review &amp; Approve Tenant</a>
        </div>
        <p style="font-size:12px;color:#64748b;line-height:1.6;">This link is unique to you. Do not forward this email. If you did not expect this request, please contact info@sharehousemanagers.com.au.</p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId },
    });
    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject, type: "shm_landlord_review_invite", status: "error", documentId: input.documentId, metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }
    await logEmailAttempt({ to, subject, type: "shm_landlord_review_invite", status: "sent", documentId: input.documentId, metadata: { resendId: data?.id } });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject, type: "shm_landlord_review_invite", status: "error", documentId: input.documentId, metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}

export async function sendLandlordApprovalNotifications(input: {
  landlordName: string;
  landlordEmail: string;
  applicantName: string;
  applicantEmail?: string | null;
  propertyAddress?: string;
  documentId: string;
  rentAmount?: unknown;
  creatorEmail?: string | null;
  creatorName?: string | null;
}): Promise<{ creator: SigningEmailResult; applicant: SigningEmailResult }> {
  const creatorTo = String(input.creatorEmail || "").trim().toLowerCase();
  const applicantTo = String(input.applicantEmail || "").trim().toLowerCase();
  const property = String(input.propertyAddress || "").trim() || undefined;
  const rent = formatRentDisplay(input.rentAmount);

  const [creator, applicant] = await Promise.all([
    creatorTo
      ? sendAdminNotificationEmail({
          to: creatorTo,
          adminName: input.creatorName || "Creator",
          subject: `Landlord approved tenant — ${input.applicantName} (${input.documentId})`,
          heading: "Landlord approved the tenant",
          intro: `${input.landlordName} (${input.landlordEmail}) has approved the Tenant Application for ${input.applicantName}. Rent: ${rent}.`,
          documentId: input.documentId,
          documentType: "Tenant Application",
          propertyAddress: property,
          signerName: input.applicantName,
          signerEmail: applicantTo || undefined,
          signerLabel: "Applicant",
          emailType: "shm_landlord_approved_creator",
        })
      : Promise.resolve({
          ok: false,
          skipped: true,
          message: "Creator email is not available.",
        } satisfies SigningEmailResult),
    applicantTo
      ? sendTenantApplicationApprovedEmail({
          to: applicantTo,
          name: input.applicantName,
          documentId: input.documentId,
          propertyAddress: property,
          landlordName: input.landlordName,
        })
      : Promise.resolve({
          ok: false,
          skipped: true,
          message: "Applicant email is not available.",
        } satisfies SigningEmailResult),
  ]);

  return { creator, applicant };
}

async function sendAdminNotificationEmail(input: {
  to?: string | null;
  adminName?: string | null;
  subject: string;
  heading: string;
  intro: string;
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  signerName?: string | null;
  signerEmail?: string | null;
  signerLabel?: string;
  fileUrl?: string | null;
  downloadUrl?: string | null;
  emailType: string;
  showDashboardButton?: boolean;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to?.trim().toLowerCase();

  if (!to) return { ok: false, skipped: true, message: "Admin email is not available for this document." };

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set. Use a verified domain address.";
    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const dashboardUrl = `${getAppUrl()}/dashboard`;
  const name = escapeHtml(input.adminName || "Admin");
  const type = escapeHtml(input.documentType);
  const docId = escapeHtml(input.documentId);
  const property = escapeHtml(input.propertyAddress || "Not specified");
  const signerName = escapeHtml(input.signerName || "Recipient");
  const signerEmail = escapeHtml(input.signerEmail || "");
  const signerLabel = escapeHtml(input.signerLabel || "Signed by");
  const downloadUrl = input.downloadUrl || "";

  const actionButtons: string[] = [];
  if (downloadUrl) {
    actionButtons.push(
      `<a href="${downloadUrl}" style="background:#1677ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;margin:6px 8px;">Download Doc</a>`,
    );
  }
  const fileButton = actionButtons.length
    ? `<div style="text-align:center;margin:18px 0;">${actionButtons.join("")}</div>`
    : "";

  const showDashboard = input.showDashboardButton !== false;
  const dashboardButtonBlock = showDashboard
    ? `<div style="text-align:center;margin:24px 0;">
          <a href="${dashboardUrl}" style="background:#1677ff;color:#fff;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Open Dashboard</a>
        </div>`
    : "";

  const html = `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${name},</p>
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">${escapeHtml(input.heading)}</h2>
        <p style="line-height:1.6;">${escapeHtml(input.intro)}</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Document ID:</strong> ${docId}</p>
          <p style="margin:0 0 8px;"><strong>Document Type:</strong> ${type}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0 0 8px;"><strong>${signerLabel}:</strong> ${signerName}${signerEmail ? ` (${signerEmail})` : ""}</p>
        </div>
        ${fileButton}
        ${dashboardButtonBlock}
        <p style="font-size:12px;color:#64748b;line-height:1.6;">This is an automated notification from the SHM document signing system.</p>
      </div>
    </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: input.subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId || "shm-admin-notification" },
    });

    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "error", documentId: input.documentId, metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }

    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "sent", documentId: input.documentId, metadata: { resendId: data?.id } });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "error", documentId: input.documentId, metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}

export function resolvePmaFinalNotifyEmail() {
  return (process.env.PMA_FINAL_NOTIFY_EMAIL || "info@sharehousemanagers.com.au").trim().toLowerCase();
}

type PmaFinalSignedEmailInput = {
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  fileUrl?: string | null;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
};

function renderPmaFinalSignedEmailHtml(input: {
  greetingName: string;
  heading: string;
  intro: string;
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  fileUrl?: string | null;
  hasAttachment: boolean;
}) {
  const type = escapeHtml(input.documentType);
  const docId = escapeHtml(input.documentId);
  const property = escapeHtml(input.propertyAddress || "Not specified");
  const owner = escapeHtml(input.recipientName || "Owner");
  const ownerEmail = escapeHtml(input.recipientEmail || "");
  const actionButtons: string[] = [];
  if (input.fileUrl) {
    actionButtons.push(
      `<a href="${escapeHtml(input.fileUrl)}" style="background:#0f766e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;margin:6px 8px;">Open in Google Drive</a>`,
    );
  }
  const fileButton = actionButtons.length
    ? `<div style="text-align:center;margin:18px 0;">${actionButtons.join("")}</div>`
    : "";
  const attachmentNote = input.hasAttachment
    ? `<p style="line-height:1.6;margin:0 0 14px;">The fully signed Word document is attached to this email for your records.</p>`
    : input.fileUrl
      ? `<p style="line-height:1.6;margin:0 0 14px;">The fully signed document is available in Google Drive using the button below.</p>`
      : `<p style="line-height:1.6;margin:0 0 14px;">The fully signed document will be shared with you separately if an attachment could not be included.</p>`;

  return `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${escapeHtml(input.greetingName)},</p>
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">${escapeHtml(input.heading)}</h2>
        <p style="line-height:1.6;">${escapeHtml(input.intro)}</p>
        ${attachmentNote}
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Document ID:</strong> ${docId}</p>
          <p style="margin:0 0 8px;"><strong>Agreement:</strong> ${type}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0;"><strong>Owner / signatory:</strong> ${owner}${ownerEmail ? ` (${ownerEmail})` : ""}</p>
        </div>
        ${fileButton}
        <p style="font-size:12px;color:#64748b;line-height:1.6;">If you have questions, contact us at <a href="mailto:info@sharehousemanagers.com.au" style="color:#1677ff;">info@sharehousemanagers.com.au</a>.</p>
      </div>
    </body></html>`;
}

async function sendPmaFinalSignedEmailWithAttachment(input: {
  to: string;
  subject: string;
  html: string;
  documentId: string;
  emailType: string;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();

  if (!to) return { ok: false, skipped: true, message: "Recipient email is missing." };

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set.";
    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "skipped", documentId: input.documentId, metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const prepared = prepareSigningEmailAttachments(input.attachments);

  async function attemptSend(includeAttachment: boolean): Promise<SigningEmailResult> {
    const attachments = includeAttachment && prepared.length
      ? prepared.map(({ filename, content, contentType }) => ({ filename, content, contentType }))
      : undefined;
    try {
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject: input.subject,
        html: input.html,
        attachments,
        headers: { "X-Entity-Ref-ID": input.documentId },
      });
      if (error) {
        const message = error.message || "Resend rejected the email.";
        await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "error", documentId: input.documentId, metadata: { error: message, includeAttachment } });
        return { ok: false, skipped: false, message };
      }
      await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "sent", documentId: input.documentId, metadata: { resendId: data?.id, includeAttachment } });
      return { ok: true, skipped: false, resendId: data?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email send failed.";
      await logEmailAttempt({ to, subject: input.subject, type: input.emailType, status: "error", documentId: input.documentId, metadata: { error: message, includeAttachment } });
      return { ok: false, skipped: false, message };
    }
  }

  let result = prepared.length ? await attemptSend(true) : await attemptSend(false);
  if (!result.ok && prepared.length) result = await attemptSend(false);
  return result;
}

/** Owner/signatory — final fully signed PMA after creator signature. */
export async function sendPmaFinalSignedRecipientEmail(input: PmaFinalSignedEmailInput & {
  to: string;
  name?: string | null;
}) {
  const property = String(input.propertyAddress || "").trim();
  const subject = property
    ? `Your signed Property Management Agreement — ${property}`
    : `Your signed Property Management Agreement — ${input.documentId}`;
  const html = renderPmaFinalSignedEmailHtml({
    greetingName: input.name || input.recipientName || "there",
    heading: "Your agreement is fully signed",
    intro:
      "Thank you for signing with ShareHouseManagers. The agency has also signed, and your Property Management Agreement is now complete.",
    documentId: input.documentId,
    documentType: input.documentType,
    propertyAddress: input.propertyAddress,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    fileUrl: input.fileUrl,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to: input.to,
    subject,
    html,
    documentId: input.documentId,
    emailType: "shm_pma_final_recipient",
    attachments: input.attachments,
  });
}

/** Internal copy for info@ (or PMA_FINAL_NOTIFY_EMAIL). */
export async function sendPmaFinalSignedInfoEmail(input: PmaFinalSignedEmailInput) {
  const to = resolvePmaFinalNotifyEmail();
  const property = String(input.propertyAddress || "").trim();
  const subject = `PMA fully signed — ${input.documentId}${property ? ` — ${property}` : ""}`;
  const html = renderPmaFinalSignedEmailHtml({
    greetingName: "Team",
    heading: "Property Management Agreement completed",
    intro:
      "Both the owner and ShareHouseManagers have signed this Property Management Agreement. A copy is attached for filing.",
    documentId: input.documentId,
    documentType: input.documentType,
    propertyAddress: input.propertyAddress,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    fileUrl: input.fileUrl,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to,
    subject,
    html,
    documentId: input.documentId,
    emailType: "shm_pma_final_info",
    attachments: input.attachments,
  });
}

export function resolveTaFinalNotifyEmail() {
  return (process.env.TA_FINAL_NOTIFY_EMAIL || "info@sharehousemanagers.com.au").trim().toLowerCase();
}

type TaFinalSignedEmailInput = {
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  landlordName?: string | null;
  landlordEmail?: string | null;
  fileUrl?: string | null;
  attachments?: Array<{ fileName: string; fileContent: string; fileType: string }>;
};

function renderTaFinalSignedEmailHtml(input: {
  greetingName: string;
  heading: string;
  intro: string;
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  landlordName?: string | null;
  landlordEmail?: string | null;
  fileUrl?: string | null;
  hasAttachment: boolean;
}) {
  const type = escapeHtml(input.documentType);
  const docId = escapeHtml(input.documentId);
  const property = escapeHtml(input.propertyAddress || "Not specified");
  const tenant = escapeHtml(input.tenantName || "Tenant");
  const tenantEmail = escapeHtml(input.tenantEmail || "");
  const landlord = escapeHtml(input.landlordName || "Landlord");
  const landlordEmail = escapeHtml(input.landlordEmail || "");
  const attachmentNote = input.hasAttachment
    ? `<p style="line-height:1.6;margin:0 0 14px;">The fully signed agreement is attached to this email for your records.</p>`
    : `<p style="line-height:1.6;margin:0 0 14px;">The fully signed agreement will be shared separately if an attachment could not be included.</p>`;

  return `
    <html><body style="font-family:Arial,sans-serif;color:#333;max-width:620px;margin:0 auto;background:#f8fafc;padding:24px;">
      <div style="background:#1677ff;padding:24px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:21px;">ShareHouseManagers</h1>
      </div>
      <div style="background:#fff;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${escapeHtml(input.greetingName)},</p>
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:20px;">${escapeHtml(input.heading)}</h2>
        <p style="line-height:1.6;">${escapeHtml(input.intro)}</p>
        ${attachmentNote}
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px;"><strong>Document ID:</strong> ${docId}</p>
          <p style="margin:0 0 8px;"><strong>Agreement:</strong> ${type}</p>
          <p style="margin:0 0 8px;"><strong>Property:</strong> ${property}</p>
          <p style="margin:0 0 8px;"><strong>Tenant:</strong> ${tenant}${tenantEmail ? ` (${tenantEmail})` : ""}</p>
          <p style="margin:0;"><strong>Landlord / rental provider:</strong> ${landlord}${landlordEmail ? ` (${landlordEmail})` : ""}</p>
        </div>
        <p style="font-size:12px;color:#64748b;line-height:1.6;">If you have questions, contact us at <a href="mailto:info@sharehousemanagers.com.au" style="color:#1677ff;">info@sharehousemanagers.com.au</a>.</p>
      </div>
    </body></html>`;
}

/** Tenant or landlord — final fully signed Tenant Agreement. */
export async function sendTenantAgreementFinalPartyEmail(
  input: TaFinalSignedEmailInput & { to: string; name?: string | null; partyRole: "tenant" | "landlord" },
) {
  const property = String(input.propertyAddress || "").trim();
  const subject = property
    ? `Your signed Tenant Agreement — ${property}`
    : `Your signed Tenant Agreement — ${input.documentId}`;
  const intro =
    input.partyRole === "landlord"
      ? "Thank you for signing with ShareHouseManagers. The tenant has also signed, and your Tenant Agreement is now complete."
      : "Thank you for signing with ShareHouseManagers. The landlord has also signed, and your Tenant Agreement is now complete.";
  const html = renderTaFinalSignedEmailHtml({
    greetingName: input.name || (input.partyRole === "landlord" ? input.landlordName : input.tenantName) || "there",
    heading: "Your agreement is fully signed",
    intro,
    documentId: input.documentId,
    documentType: input.documentType,
    propertyAddress: input.propertyAddress,
    tenantName: input.tenantName,
    tenantEmail: input.tenantEmail,
    landlordName: input.landlordName,
    landlordEmail: input.landlordEmail,
    fileUrl: input.fileUrl,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to: input.to,
    subject,
    html,
    documentId: input.documentId,
    emailType: input.partyRole === "landlord" ? "shm_ta_final_landlord" : "shm_ta_final_tenant",
    attachments: input.attachments,
  });
}

/** Internal copy for info@ (or TA_FINAL_NOTIFY_EMAIL). */
export async function sendTenantAgreementFinalInfoEmail(input: TaFinalSignedEmailInput) {
  const to = resolveTaFinalNotifyEmail();
  const property = String(input.propertyAddress || "").trim();
  const subject = `Tenant Agreement fully signed — ${input.documentId}${property ? ` — ${property}` : ""}`;
  const html = renderTaFinalSignedEmailHtml({
    greetingName: "Team",
    heading: "Tenant Agreement completed",
    intro:
      "The tenant and landlord have both signed this Tenant Agreement. A copy is attached for filing.",
    documentId: input.documentId,
    documentType: input.documentType,
    propertyAddress: input.propertyAddress,
    tenantName: input.tenantName,
    tenantEmail: input.tenantEmail,
    landlordName: input.landlordName,
    landlordEmail: input.landlordEmail,
    fileUrl: input.fileUrl,
    hasAttachment: Boolean(input.attachments?.length),
  });
  return sendPmaFinalSignedEmailWithAttachment({
    to,
    subject,
    html,
    documentId: input.documentId,
    emailType: "shm_ta_final_info",
    attachments: input.attachments,
  });
}

export async function sendAdminRecipientSignedEmail(input: {
  to?: string | null;
  adminName?: string | null;
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  signerName?: string | null;
  signerEmail?: string | null;
}) {
  return sendAdminNotificationEmail({
    ...input,
    subject: `${input.documentType} Signed - ${input.documentId}`,
    heading: `${input.documentType} signed`,
    intro: "The recipient has signed the document. The signed file is now being processed and will appear in the dashboard once the Google Drive upload is complete.",
    emailType: "shm_admin_recipient_signed",
  });
}

export async function sendAdminFinalFileReadyEmail(input: {
  to?: string | null;
  adminName?: string | null;
  documentId: string;
  documentType: string;
  propertyAddress?: string | null;
  signerName?: string | null;
  signerEmail?: string | null;
  fileUrl?: string | null;
}) {
  const downloadUrl = await ensureAdminDocumentDownloadUrl(input.documentId);
  return sendAdminNotificationEmail({
    ...input,
    downloadUrl,
    subject: `Signed Document Ready - ${input.documentId}`,
    heading: "Signed document ready",
    intro:
      "The final signed document has been uploaded to Google Drive. Use Download Doc to save the file directly, or open it from the dashboard.",
    emailType: "shm_admin_final_file_ready",
    showDashboardButton: !isTenantApplication(input.documentType),
  });
}

export async function sendOtpEmail(input: {
  to: string;
  name?: string;
  code: string;
  documentId: string;
  documentType: string;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = `Your verification code for ${input.documentType}`;

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_otp",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message, code: input.code },
    });
    return { ok: false, skipped: true, message: `${message} Dev code: ${input.code}` };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({
      to,
      subject,
      type: "shm_otp",
      status: "skipped",
      documentId: input.documentId,
      metadata: { reason: message },
    });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const safeName = escapeHtml(input.name || "Applicant");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:24px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">Verify to continue</h1>
      <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.55">Hi ${safeName}, use this code to open your ${escapeHtml(input.documentType)} securely:</p>
      <p style="margin:0 0 16px;font-size:32px;letter-spacing:0.35em;font-weight:800;color:#0f172a">${escapeHtml(input.code)}</p>
      <p style="margin:0;color:#64748b;font-size:12px">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    </div>
  </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": input.documentId },
    });
    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject, type: "shm_otp", status: "error", documentId: input.documentId, metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }
    await logEmailAttempt({ to, subject, type: "shm_otp", status: "sent", documentId: input.documentId, metadata: { resendId: data?.id } });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject, type: "shm_otp", status: "error", documentId: input.documentId, metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name?: string;
  resetUrl: string;
}): Promise<SigningEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = "Reset your ShareHouse Managers password";

  if (!apiKey) {
    const message = "RESEND_API_KEY is not set. Add it to your environment variables.";
    await logEmailAttempt({ to, subject, type: "auth_password_reset", status: "skipped", metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  if (!from) {
    const message = "EMAIL_FROM is not set.";
    await logEmailAttempt({ to, subject, type: "auth_password_reset", status: "skipped", metadata: { reason: message } });
    return { ok: false, skipped: true, message };
  }

  const resend = new Resend(apiKey);
  const safeName = escapeHtml(input.name || "there");
  const safeUrl = escapeHtml(input.resetUrl);
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;color:#333">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:#0f172a;padding:24px 28px">
        <h1 style="margin:0;color:#fff;font-size:20px">ShareHouse Managers</h1>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 14px">Hi ${safeName},</p>
        <p style="margin:0 0 18px;line-height:1.6;color:#475569">
          We received a request to reset the password for your signing workspace account.
          Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
        </p>
        <p style="margin:0 0 22px">
          <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">
            Reset password
          </a>
        </p>
        <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all">
          Or paste this link into your browser:<br>${safeUrl}
        </p>
        <p style="margin:0;font-size:12px;color:#94a3b8">
          If you did not request a password reset, you can ignore this email. Your password will stay the same.
        </p>
      </div>
    </div>
  </body></html>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers: { "X-Entity-Ref-ID": `password-reset-${to}` },
    });
    if (error) {
      const message = error.message || "Resend rejected the email.";
      await logEmailAttempt({ to, subject, type: "auth_password_reset", status: "error", metadata: { error: message } });
      return { ok: false, skipped: false, message };
    }
    await logEmailAttempt({ to, subject, type: "auth_password_reset", status: "sent", metadata: { resendId: data?.id } });
    return { ok: true, skipped: false, resendId: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    await logEmailAttempt({ to, subject, type: "auth_password_reset", status: "error", metadata: { error: message } });
    return { ok: false, skipped: false, message };
  }
}
