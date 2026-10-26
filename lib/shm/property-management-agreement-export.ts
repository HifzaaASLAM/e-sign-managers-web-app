import { generatePropertyManagementAgreementDocx } from "./property-management-agreement-docx";

export { buildPropertyManagementAgreementTemplateData } from "./property-management-agreement-docx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function generatePropertyManagementAgreementPdf(
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  const docxBuffer = await generatePropertyManagementAgreementDocx(data, options);
  return { buffer: docxBuffer, mimeType: DOCX_MIME, docxBuffer };
}

export async function generatePropertyManagementAgreementPdfBase64(
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  const generated = await generatePropertyManagementAgreementPdf(data, options);
  return {
    base64: generated.buffer.toString("base64"),
    mimeType: generated.mimeType,
    isPdf: false,
    docxBase64: generated.docxBuffer.toString("base64"),
  };
}
