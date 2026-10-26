import { NextResponse } from "next/server";
import { generateRentalReferencePdfBase64 } from "../../../../../lib/shm/rental-reference-export";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const agreementData = (body?.agreement_data || body?.agreementData || body || {}) as Record<string, unknown>;
  const signature = String(body?.signature || "").trim();
  try {
    const generated = await generateRentalReferencePdfBase64(agreementData, { signature: signature || undefined });
    return NextResponse.json({
      success: true,
      fileContent: generated.base64,
      docxContent: generated.docxBase64,
      fileType: generated.mimeType,
    });
  } catch (error) {
    console.error("[rental-reference/generate-pdf]", error);
    return NextResponse.json({ message: "Could not generate rental reference document." }, { status: 500 });
  }
}
