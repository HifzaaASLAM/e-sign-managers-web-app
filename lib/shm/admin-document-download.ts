import { timingSafeEqual } from "crypto";
import { prisma } from "../prisma";
import { parseAgreementData } from "../dashboard/document-file";
import { createToken, getAppUrl, isPropertyManagementAgreement } from "./documents";

const TOKEN_KEY = "admin_file_download_token";

function tokensMatch(stored: string, provided: string) {
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function adminFileDownloadTokenFromAgreementData(agreementDataRaw: string | null | undefined) {
  const data = parseAgreementData(agreementDataRaw);
  const token = String(data?.[TOKEN_KEY] || "").trim();
  return token || null;
}

export function buildAdminDocumentDownloadUrl(
  documentId: string,
  downloadToken: string,
  documentType?: string | null,
) {
  const format = isPropertyManagementAgreement(String(documentType || "")) ? "docx" : "pdf";
  const params = new URLSearchParams({
    doc_id: documentId,
    token: downloadToken,
    format,
    download: "1",
  });
  return `${getAppUrl()}/shm-docs/admin-document-file?${params.toString()}`;
}

/** Browser inline open (no forced download) — for PMA CC view-only emails. */
export function buildAdminDocumentInlineViewUrl(
  documentId: string,
  downloadToken: string,
  documentType?: string | null,
) {
  const format = isPropertyManagementAgreement(String(documentType || "")) ? "docx" : "pdf";
  const params = new URLSearchParams({
    doc_id: documentId,
    token: downloadToken,
    format,
  });
  return `${getAppUrl()}/shm-docs/admin-document-file?${params.toString()}`;
}

/** Mint (if needed) a long-lived token for admin email download links after signing tokens are revoked. */
export async function ensureAdminDocumentDownloadUrl(documentId: string): Promise<string | null> {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    select: { agreementData: true, documentType: true },
  });
  if (!doc) return null;

  let token = adminFileDownloadTokenFromAgreementData(doc.agreementData);
  if (!token) {
    token = createToken();
    let existing: Record<string, unknown> = {};
    try {
      existing = doc.agreementData ? (JSON.parse(doc.agreementData) as Record<string, unknown>) : {};
    } catch {
      existing = {};
    }
    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        agreementData: JSON.stringify({ ...existing, [TOKEN_KEY]: token }),
      },
    });
  }

  return buildAdminDocumentDownloadUrl(documentId, token, doc.documentType);
}

export async function ensureAdminDocumentInlineViewUrl(documentId: string): Promise<string | null> {
  const downloadUrl = await ensureAdminDocumentDownloadUrl(documentId);
  if (!downloadUrl) return null;
  const url = new URL(downloadUrl);
  url.searchParams.delete("download");
  return url.toString();
}

export async function loadDocumentForAdminFileDownload(docId: string, token: string) {
  if (!docId || !token) return null;
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId: docId },
    select: {
      documentId: true,
      documentType: true,
      agreementData: true,
      signedDriveUrl: true,
    },
  });
  if (!doc) return null;
  const stored = adminFileDownloadTokenFromAgreementData(doc.agreementData);
  if (!stored || !tokensMatch(stored, token)) return null;
  return doc;
}
