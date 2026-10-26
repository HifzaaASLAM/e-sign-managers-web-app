import { NextResponse } from "next/server";
import { renderSigningEmailHtml, sanitizeSigningEmailBodyPlain } from "../../../../lib/shm/signing-email-templates";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const documentType = String(body.documentType || "").trim();
    if (!documentType) {
      return NextResponse.json({ ok: false, message: "documentType is required." }, { status: 400 });
    }

    const html = renderSigningEmailHtml({
      documentType,
      recipientName: String(body.recipientName || "Recipient").trim(),
      recipientEmail: String(body.recipientEmail || "recipient@example.com").trim(),
      propertyAddress: String(body.propertyAddress || "").trim(),
      signingUrl: "#",
      documentId: String(body.documentId || "PREVIEW").trim(),
      subject: String(body.subject || "").trim(),
      body: sanitizeSigningEmailBodyPlain(String(body.body || "")),
      preview: true,
      hasAnyAttachment: Boolean(body.hasAttachment),
      hasDocxAttachment: Boolean(body.hasDocxAttachment ?? body.hasAttachment),
    });

    return NextResponse.json({ ok: true, html });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
