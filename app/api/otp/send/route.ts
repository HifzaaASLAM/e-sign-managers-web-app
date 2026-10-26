import { NextResponse } from "next/server";
import { isTenantApplication, validateShmTokenLite } from "../../../../lib/shm/documents";
import { createOtpChallenge } from "../../../../lib/applications/otp";
import { sendOtpEmail } from "../../../../lib/shm/mailer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const documentId = String(body.documentId || body.doc_id || "").trim();
  const token = String(body.token || "").trim();

  if (!documentId || !token) {
    return NextResponse.json({ ok: false, message: "documentId and token are required." }, { status: 400 });
  }

  const doc = await validateShmTokenLite(documentId, token);
  if (!doc) {
    return NextResponse.json({ ok: false, message: "Invalid signing link." }, { status: 403 });
  }

  if (!isTenantApplication(doc.documentType)) {
    return NextResponse.json({ ok: false, message: "OTP is only required for Tenant Applications." }, { status: 400 });
  }

  const signer = doc.signers.find((s) => s.token === token);
  const email = (signer?.email || doc.recipientEmail || "").toLowerCase();
  const name = signer?.name || doc.recipientName;
  if (!email) {
    return NextResponse.json({ ok: false, message: "No email on this signing link." }, { status: 400 });
  }

  const { code } = await createOtpChallenge(documentId, email);
  const emailResult = await sendOtpEmail({
    to: email,
    name,
    code,
    documentId,
    documentType: doc.documentType,
  });

  const payload: Record<string, unknown> = {
    ok: true,
    message: emailResult.ok
      ? `Verification code sent to ${email}`
      : emailResult.skipped
        ? `Email skipped: ${emailResult.message}`
        : `Could not send email: ${emailResult.message}`,
    emailStatus: emailResult.ok ? "sent" : emailResult.skipped ? "skipped" : "error",
    maskedEmail: email.replace(/(.{2}).+(@.+)/, "$1***$2"),
  };

  // Surface code only when Resend is not configured (local/dev).
  if (emailResult.skipped && /Dev code:/i.test(emailResult.message || "")) {
    payload.devCode = code;
  }

  return NextResponse.json(payload);
}
