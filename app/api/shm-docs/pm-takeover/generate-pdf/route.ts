import { NextResponse } from "next/server";
import { validateShmSignerToken, isPmTakeoverForm } from "../../../../../lib/shm/documents";
import { generatePmTakeoverPdfBase64 } from "../../../../../lib/shm/pm-takeover-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();
    const agreementData = (body?.agreement_data || body?.field_values || {}) as Record<string, unknown>;
    const signature = String(body?.signature || "").trim();

    if (!docId || !token) {
      return NextResponse.json({ message: "Missing doc_id or token." }, { status: 400 });
    }

    const validation = await validateShmSignerToken(docId, token);
    if (!validation?.document) {
      return NextResponse.json({ message: "Invalid document or token." }, { status: 403 });
    }

    if (!isPmTakeoverForm(validation.document.documentType)) {
      return NextResponse.json({ message: "This endpoint is only for PM Takeover Form documents." }, { status: 400 });
    }

    const generated = await generatePmTakeoverPdfBase64(agreementData, { signature });

    return NextResponse.json({
      ok: true,
      fileContent: generated.base64,
      fileType: generated.mimeType,
      isPdf: generated.isPdf,
      docxContent: generated.docxBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate PM Takeover Form document.";
    console.error("[pm-takeover/generate-pdf]", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
