import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { getDashboardDocumentFileUrl } from "../../../../../lib/dashboard/document-file";
import {
  isPropertyManagementAgreement,
  isTenantAgreement,
  isTenantApplication,
} from "../../../../../lib/shm/documents";
import { DashboardDocumentPreviewFrame } from "../../../../../components/dashboard/DashboardDocumentPreviewFrame";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { documentId: string };
};

export default async function DocumentPreviewPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) redirect("/register");

  const documentId = decodeURIComponent(params.documentId || "").trim();
  if (!documentId) notFound();

  const doc = await prisma.shmDocument.findFirst({
    where: { companyId: company.id, documentId },
    select: { documentId: true, documentType: true, agreementData: true, propertyAddress: true, recipientName: true },
  });
  if (!doc) notFound();

  const docTypeLower = String(doc.documentType || "").trim().toLowerCase();
  const canPreview =
    getDashboardDocumentFileUrl(doc.documentId, doc.agreementData, doc.documentType)
    || docTypeLower === "tenant agreement"
    || docTypeLower === "property management agreement"
    || docTypeLower === "tenant application";
  if (!canPreview) {
    return (
      <main className="flex min-h-screen flex-col bg-slate-50">
        <PreviewHeader documentId={doc.documentId} />
        <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-600">
          No preview is available for this document yet.
        </div>
      </main>
    );
  }

  const docType = doc.documentType || "";
  const useDocxPreview =
    isPropertyManagementAgreement(docType)
    || isTenantAgreement(docType)
    || isTenantApplication(docType);
  const previewFormat = useDocxPreview ? "docx" : "pdf";
  const title = [doc.recipientName, doc.propertyAddress, doc.documentType].filter(Boolean).join(" · ");

  return (
    <main className="flex h-screen flex-col bg-slate-100">
      <PreviewHeader documentId={doc.documentId} title={title} />
      <DashboardDocumentPreviewFrame documentId={doc.documentId} format={previewFormat} />
    </main>
  );
}

function PreviewHeader({ documentId, title }: { documentId: string; title?: string }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Preview</p>
        {title ? <p className="truncate text-sm font-semibold text-slate-900">{title}</p> : null}
      </div>
      <Link
        href={`/dashboard/documents/${encodeURIComponent(documentId)}`}
        className="shrink-0 text-sm font-medium text-blue-700 hover:text-blue-900"
      >
        Back to document
      </Link>
    </header>
  );
}
