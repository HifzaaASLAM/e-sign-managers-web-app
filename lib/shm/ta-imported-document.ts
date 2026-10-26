import type { TaTemplateAgreementData } from "./ta-templates";

export const IMPORTED_DOCX_B64_KEY = "imported_docx_b64";
export const IMPORTED_DOCX_NAME_KEY = "imported_docx_file_name";
export const IMPORTED_PDF_B64_KEY = "imported_pdf_b64";
export const IMPORTED_PDF_NAME_KEY = "imported_pdf_file_name";
export const IMPORTED_DOCUMENT_FORMAT_KEY = "imported_document_format";

/** Max upload size for imported template documents (bytes). */
export const MAX_IMPORTED_DOCX_BYTES = 15 * 1024 * 1024;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

export type ImportedDocumentFormat = "pdf" | "docx";

export function importedDocumentFormat(data: Record<string, unknown>): ImportedDocumentFormat | null {
  const explicit = String(data[IMPORTED_DOCUMENT_FORMAT_KEY] || "").toLowerCase();
  if (explicit === "pdf" || explicit === "docx") return explicit;
  if (getImportedPdfBuffer(data)) return "pdf";
  if (getImportedDocxBuffer(data)) return "docx";
  return null;
}

export function isImportedTenantAgreementTemplate(data: TaTemplateAgreementData | Record<string, unknown>) {
  if (data.imported_document !== true) return false;
  return Boolean(getImportedPdfBuffer(data) || getImportedDocxBuffer(data));
}

export function getImportedDocxBuffer(data: Record<string, unknown>): Buffer | null {
  const b64 = String(data[IMPORTED_DOCX_B64_KEY] || "").trim();
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

export function getImportedPdfBuffer(data: Record<string, unknown>): Buffer | null {
  const b64 = String(data[IMPORTED_PDF_B64_KEY] || "").trim();
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

export function getImportedDocumentBuffer(
  data: Record<string, unknown>,
): { buffer: Buffer; mimeType: string; format: ImportedDocumentFormat } | null {
  const pdf = getImportedPdfBuffer(data);
  if (pdf) return { buffer: pdf, mimeType: PDF_MIME, format: "pdf" };
  const docx = getImportedDocxBuffer(data);
  if (docx) {
    return { buffer: docx, mimeType: DOCX_MIME, format: "docx" };
  }
  return null;
}

export function importedDocxFileName(data: Record<string, unknown>, fallback = "tenant-agreement.docx") {
  const name = String(data[IMPORTED_DOCX_NAME_KEY] || "").trim();
  return name || fallback;
}

export function importedPdfFileName(data: Record<string, unknown>, fallback = "tenant-agreement.pdf") {
  const name = String(data[IMPORTED_PDF_NAME_KEY] || "").trim();
  return name || fallback;
}

export function importedDocumentFileName(data: Record<string, unknown>, fallbackBase = "tenant-agreement") {
  const format = importedDocumentFormat(data);
  if (format === "pdf") return importedPdfFileName(data, `${fallbackBase}.pdf`);
  if (format === "docx") return importedDocxFileName(data, `${fallbackBase}.docx`);
  return `${fallbackBase}.docx`;
}

export function detectImportFormat(mime: string, fileName: string): ImportedDocumentFormat | null {
  const lower = fileName.toLowerCase();
  const m = mime.toLowerCase();
  if (lower.endsWith(".pdf") || m === PDF_MIME) return "pdf";
  if (lower.endsWith(".docx") || m === DOCX_MIME) return "docx";
  if (m === "application/octet-stream") {
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".docx")) return "docx";
  }
  return null;
}

export function isAcceptedImportMime(mime: string, fileName: string) {
  return detectImportFormat(mime, fileName) !== null;
}

export function buildImportedTemplateAgreementData(input: {
  landlordName: string;
  propertyAddress: string;
  fileBase64: string;
  originalFileName: string;
  format: ImportedDocumentFormat;
}): TaTemplateAgreementData {
  const common = {
    imported_document: true,
    [IMPORTED_DOCUMENT_FORMAT_KEY]: input.format,
    provider_name: input.landlordName,
    premises_address: input.propertyAddress,
  };
  if (input.format === "pdf") {
    return {
      ...common,
      [IMPORTED_PDF_B64_KEY]: input.fileBase64,
      [IMPORTED_PDF_NAME_KEY]: input.originalFileName,
    };
  }
  return {
    ...common,
    [IMPORTED_DOCX_B64_KEY]: input.fileBase64,
    [IMPORTED_DOCX_NAME_KEY]: input.originalFileName,
  };
}
