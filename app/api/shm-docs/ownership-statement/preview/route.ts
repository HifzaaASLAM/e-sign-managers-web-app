import { NextResponse } from "next/server";
import { validateShmToken } from "../../../../../lib/shm/documents";
import { generateOwnershipStatementPdf } from "../../../../../lib/shm/ownership-statement-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "").trim();
  const token = String(body?.token || "").trim();
  const doc = await validateShmToken(docId, token);
  if (!doc || doc.adminToken !== token) {
    return NextResponse.json({ message: "Invalid admin signing link" }, { status: 403 });
  }

  const agreementData = (body?.agreement_data || body?.agreementData || {}) as Record<string, unknown>;
  const exportInput = {
    ...agreementData,
    owner_name: String(agreementData.owner_name || agreementData.owner_name_field || doc.recipientName || "").trim(),
    owner_email: String(agreementData.owner_email || agreementData.owner_email_field || doc.recipientEmail || "").trim(),
  };

  try {
    const generated = await generateOwnershipStatementPdf(exportInput);
    const fileName = generated.fileNameSuffix === "pdf"
      ? "ownership-statement-preview.pdf"
      : "ownership-statement-preview.docx";

    return new NextResponse(new Uint8Array(generated.buffer), {
      status: 200,
      headers: {
        "Content-Type": generated.mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Preview-Format": generated.fileNameSuffix,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate ownership statement preview.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
