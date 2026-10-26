import { stripDataUri } from "../shm/file-content";
import { isLandlordWeeklyReport, isPropertyManagementAgreement, isTenantAgreement } from "../shm/documents";
import { isMultiTenantAgreementData } from "../shm/multi-tenant-signatures";
import { getImportedPdfBuffer, isImportedTenantAgreementTemplate } from "../shm/ta-imported-document";

export type StoredDocumentFile = {
  fileName: string;
  fileType: string;
  fileContent: string;
};

export type StoredSubmission = {
  fileName: string;
  fileType: string;
  fileContent: string;
  pdfFileName?: string;
  pdfFileType?: string;
  pdfFileContent?: string;
  docxFileName?: string;
  docxFileType?: string;
  docxFileContent?: string;
};

export function parseAgreementData(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getMultiTenantCombinedFile(agreementDataRaw: string | null | undefined): StoredDocumentFile | null {
  const agreementData = parseAgreementData(agreementDataRaw);
  if (!agreementData) return null;
  const fileContent = String(agreementData.multi_tenant_combined_b64 || "").trim();
  if (!fileContent) return null;
  const fileType = String(agreementData.multi_tenant_combined_mime || "application/pdf");
  const isPdf = fileType.includes("pdf");
  return {
    fileName: `Tenant-Agreement-combined.${isPdf ? "pdf" : "docx"}`,
    fileType,
    fileContent,
  };
}

function submissionFromLast(agreementData: Record<string, unknown> | null): StoredSubmission | null {
  const submission = agreementData?.last_submission;
  if (!submission || typeof submission !== "object") return null;

  const row = submission as Record<string, unknown>;
  const fileContent = String(row.fileContent || "").trim();
  const pdfFileContent = String(row.pdfFileContent || "").trim();
  const docxFileContent = String(row.docxFileContent || "").trim();

  if (!fileContent && !pdfFileContent && !docxFileContent) return null;

  return {
    fileName: String(row.fileName || row.pdfFileName || row.docxFileName || "document.pdf"),
    fileType: String(row.fileType || row.pdfFileType || row.docxFileType || "application/pdf"),
    fileContent,
    pdfFileName: row.pdfFileName ? String(row.pdfFileName) : undefined,
    pdfFileType: row.pdfFileType ? String(row.pdfFileType) : undefined,
    pdfFileContent: pdfFileContent || undefined,
    docxFileName: row.docxFileName ? String(row.docxFileName) : undefined,
    docxFileType: row.docxFileType ? String(row.docxFileType) : undefined,
    docxFileContent: docxFileContent || undefined,
  };
}

export function getStoredSubmission(agreementDataRaw: string | null | undefined): StoredSubmission | null {
  const agreementData = parseAgreementData(agreementDataRaw);
  const combined = getMultiTenantCombinedFile(agreementDataRaw);
  if (combined?.fileContent) {
    try {
      const decoded = decodeStoredFileContent(combined.fileContent);
      if (decoded.length > 0) {
        const isPdf = combined.fileType.includes("pdf");
        return {
          fileName: combined.fileName,
          fileType: combined.fileType,
          fileContent: combined.fileContent,
          pdfFileName: isPdf ? combined.fileName : undefined,
          pdfFileType: isPdf ? combined.fileType : undefined,
          pdfFileContent: isPdf ? combined.fileContent : undefined,
          docxFileName: !isPdf ? combined.fileName : undefined,
          docxFileType: !isPdf ? combined.fileType : undefined,
          docxFileContent: !isPdf ? combined.fileContent : undefined,
        };
      }
    } catch {
      // fall through to last_submission
    }
  }
  return submissionFromLast(agreementData);
}

export function canServeImportedAgreementPreview(agreementDataRaw: string | null | undefined) {
  const agreementData = parseAgreementData(agreementDataRaw);
  if (!agreementData || !isImportedTenantAgreementTemplate(agreementData)) return false;
  return Boolean(getImportedPdfBuffer(agreementData));
}

/** Stored base64 previews can lag behind branding/logic changes — regenerate when possible. */
export function shouldPreferFreshAgreementPreview(
  agreementDataRaw: string | null | undefined,
  documentType?: string | null,
) {
  const type = String(documentType || "").trim().toLowerCase();
  if (type === "tenant agreement" || type === "property management agreement") return true;
  const agreementData = parseAgreementData(agreementDataRaw);
  if (!agreementData) return false;
  if (isMultiTenantAgreementData(agreementData)) return true;
  return canServeImportedAgreementPreview(agreementDataRaw);
}

export function pickStoredPreviewFile(
  submission: StoredSubmission,
  preferred: "pdf" | "docx" | "auto" = "auto",
): StoredDocumentFile | null {
  const pdf = submission.pdfFileContent
    ? {
        fileName: submission.pdfFileName || submission.fileName.replace(/\.docx$/i, ".pdf"),
        fileType: submission.pdfFileType || "application/pdf",
        fileContent: submission.pdfFileContent,
      }
    : submission.fileType.includes("pdf") && submission.fileContent
      ? {
          fileName: submission.fileName,
          fileType: submission.fileType,
          fileContent: submission.fileContent,
        }
      : null;

  const docx = submission.docxFileContent
    ? {
        fileName: submission.docxFileName || submission.fileName.replace(/\.pdf$/i, ".docx"),
        fileType: submission.docxFileType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileContent: submission.docxFileContent,
      }
    : submission.fileType.includes("wordprocessingml") && submission.fileContent
      ? {
          fileName: submission.fileName,
          fileType: submission.fileType,
          fileContent: submission.fileContent,
        }
      : null;

  if (preferred === "pdf") return pdf || docx;
  if (preferred === "docx") return docx || pdf;
  return pdf || docx || (submission.fileContent
    ? { fileName: submission.fileName, fileType: submission.fileType, fileContent: submission.fileContent }
    : null);
}

export function buildDashboardDocumentDownloadHref(documentId: string) {
  const base = `/api/dashboard/documents/${encodeURIComponent(documentId)}/file`;
  return `${base}?format=docx&download=1`;
}

/** In-app preview (new tab) — avoids browsers forcing .docx download from the file API. */
export function buildDashboardDocumentPreviewPageHref(documentId: string) {
  return `/dashboard/documents/${encodeURIComponent(documentId)}/preview`;
}

export function getDashboardDocumentFileUrl(
  documentId: string,
  agreementDataRaw: string | null | undefined,
  documentType?: string | null,
) {
  const type = String(documentType || "");
  if (
    (isPropertyManagementAgreement(type) || isTenantAgreement(type))
    && parseAgreementData(agreementDataRaw)
  ) {
    return `/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=docx`;
  }
  if (isLandlordWeeklyReport(type)) {
    return `/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=pdf`;
  }

  const submission = getStoredSubmission(agreementDataRaw);
  if (submission && pickStoredPreviewFile(submission)) {
    return `/api/dashboard/documents/${encodeURIComponent(documentId)}/file`;
  }
  if (canServeImportedAgreementPreview(agreementDataRaw)) {
    return `/api/dashboard/documents/${encodeURIComponent(documentId)}/file`;
  }
  return null;
}

export function decodeStoredFileContent(fileContent: string) {
  return Buffer.from(stripDataUri(fileContent), "base64");
}
