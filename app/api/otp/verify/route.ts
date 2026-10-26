import { NextResponse } from "next/server";
import { isTenantApplication, validateShmTokenLite } from "../../../../lib/shm/documents";
import { otpCookieName, verifyOtpChallenge } from "../../../../lib/applications/otp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const documentId = String(body.documentId || body.doc_id || "").trim();
  const token = String(body.token || "").trim();
  const code = String(body.code || "").trim();

  if (!documentId || !token || !code) {
    return NextResponse.json({ ok: false, message: "documentId, token, and code are required." }, { status: 400 });
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
  const result = await verifyOtpChallenge(documentId, email, code);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, message: "Verified." });
  response.cookies.set({
    name: otpCookieName(documentId),
    value: result.cookieValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
