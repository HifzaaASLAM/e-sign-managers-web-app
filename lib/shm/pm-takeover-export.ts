import { generatePmTakeoverDocx } from "./pm-takeover-docx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function generatePmTakeoverPdf(
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const docxBuffer = await generatePmTakeoverDocx(data, options);
  return { buffer: docxBuffer, mimeType: DOCX_MIME, docxBuffer };
}

export async function generatePmTakeoverPdfBase64(
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const generated = await generatePmTakeoverPdf(data, options);
  return {
    base64: generated.buffer.toString("base64"),
    mimeType: generated.mimeType,
    isPdf: false,
    docxBase64: generated.docxBuffer.toString("base64"),
  };
}
