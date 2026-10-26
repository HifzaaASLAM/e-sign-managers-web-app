import { generateRentalReferenceDocx } from "./rental-reference-docx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function generateRentalReferencePdf(
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const docxBuffer = await generateRentalReferenceDocx(data, options);
  return { buffer: docxBuffer, mimeType: DOCX_MIME, docxBuffer };
}

export async function generateRentalReferencePdfBase64(
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const generated = await generateRentalReferencePdf(data, options);
  return {
    base64: generated.buffer.toString("base64"),
    mimeType: generated.mimeType,
    isPdf: false,
    docxBase64: generated.docxBuffer.toString("base64"),
  };
}
