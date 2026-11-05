import { Resend } from "resend";
import { prisma } from "../prisma";

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

export async function sendInspectionCaptureInviteEmail(input: {
  to: string;
  name: string;
  propertyName: string;
  tenantName: string;
  captureUrl: string;
  inspectionId: string;
}): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();
  const to = input.to.trim().toLowerCase();
  const subject = `Entry inspection photos requested — ${input.propertyName}`;

  if (!apiKey) {
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        type: "inspection_capture_invite",
        status: "skipped",
        metadata: JSON.stringify({ reason: "RESEND_API_KEY is not set", inspectionId: input.inspectionId }),
      },
    }).catch(() => undefined);
    return { ok: false, skipped: true, message: "RESEND_API_KEY is not set." };
  }

  if (!from) {
    return { ok: false, skipped: true, message: "EMAIL_FROM is not set." };
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
      <img src="${process.env.NEXT_PUBLIC_APP_URL || ""}/shm-logo.png" alt="ShareHouse Managers" height="36" style="margin-bottom:20px;" />
      <h1 style="font-size:20px;margin:0 0 12px;">Entry inspection</h1>
      <p style="font-size:15px;line-height:1.6;color:#334155;">
        Hi ${escapeHtml(input.name)}, please open the link below to upload photos for the entry inspection at
        <strong>${escapeHtml(input.propertyName)}</strong> (tenant: ${escapeHtml(input.tenantName)}).
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(input.captureUrl)}"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600;">
          Open inspection link
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;word-break:break-all;">${escapeHtml(input.captureUrl)}</p>
    </div>
  `;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to,
      subject,
      html,
    });
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        type: "inspection_capture_invite",
        status: "sent",
        metadata: JSON.stringify({ inspectionId: input.inspectionId }),
      },
    }).catch(() => undefined);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    await prisma.emailLog.create({
      data: {
        to,
        subject,
        type: "inspection_capture_invite",
        status: "error",
        metadata: JSON.stringify({ inspectionId: input.inspectionId, message }),
      },
    }).catch(() => undefined);
    return { ok: false, message };
  }
}
