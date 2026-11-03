import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../../lib/auth";
import { prisma } from "../../../../../../lib/prisma";
import { buildDashboardDocumentFileResponse } from "../../../../../../lib/dashboard/serve-document-file";
import {
  isPropertyManagementAgreement,
  isTenantApplication,
} from "../../../../../../lib/shm/documents";
import { getWorkspaceByEmail } from "../../../../../../lib/workspace";

export const dynamic = "force-dynamic";

type RouteContext = { params: { documentId: string } };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ message: "Workspace not found" }, { status: 403 });
  }

  const documentId = decodeURIComponent(params.documentId || "").trim();
  if (!documentId) {
    return NextResponse.json({ message: "Document ID is required" }, { status: 400 });
  }

  const doc = await prisma.shmDocument.findFirst({
    where: { companyId: company.id, documentId },
    select: { agreementData: true, signedDriveUrl: true, documentType: true },
  });

  if (!doc) {
    return NextResponse.json({ message: "Document not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const formatParam = url.searchParams.get("format");
  const format =
    formatParam === "docx"
      ? "docx"
      : formatParam === "pdf"
        ? "pdf"
        : isPropertyManagementAgreement(doc.documentType || "")
          || isTenantApplication(doc.documentType || "")
          ? "docx"
          : "pdf";
  const asAttachment =
    url.searchParams.get("download") === "1" || url.searchParams.get("attachment") === "1";

  return buildDashboardDocumentFileResponse(
    {
      agreementData: doc.agreementData,
      signedDriveUrl: doc.signedDriveUrl,
      documentType: doc.documentType,
      documentId,
    },
    format,
    asAttachment,
  );
}
