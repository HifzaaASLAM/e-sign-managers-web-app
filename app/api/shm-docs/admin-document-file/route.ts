import { NextResponse } from "next/server";
import { buildDashboardDocumentFileResponse } from "../../../../lib/dashboard/serve-document-file";
import { loadDocumentForAdminFileDownload } from "../../../../lib/shm/admin-document-download";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = String(url.searchParams.get("doc_id") || "").trim();
  const token = decodeURIComponent(String(url.searchParams.get("token") || "").trim());
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const asAttachment =
    url.searchParams.get("download") === "1" || url.searchParams.get("attachment") === "1";

  if (!documentId || !token) {
    return NextResponse.json({ message: "Missing document or access token." }, { status: 400 });
  }

  const doc = await loadDocumentForAdminFileDownload(documentId, token);
  if (!doc) {
    return NextResponse.json({ message: "Invalid or expired download link." }, { status: 403 });
  }

  return buildDashboardDocumentFileResponse(
    {
      agreementData: doc.agreementData,
      signedDriveUrl: doc.signedDriveUrl,
      documentType: doc.documentType,
      documentId: doc.documentId,
    },
    format,
    asAttachment,
  );
}
