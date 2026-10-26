import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { isOwnershipStatement, logShmEvent, rollupDocumentStatus, validateShmSignerToken } from "../../../../lib/shm/documents";
import { markOwnershipStatementOwnerViewed } from "../../../../lib/shm/ownership-statement-status";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const docId = String(body?.doc_id || "");
  const token = String(body?.token || "");
  const validation = await validateShmSignerToken(docId, token);
  if (!validation?.document) return NextResponse.json({ message: "Invalid document or token" }, { status: 403 });

  const { document: doc, signer } = validation;

  if (isOwnershipStatement(doc.documentType) && signer?.signerType === "recipient") {
    await markOwnershipStatementOwnerViewed(docId, token, request);
    return NextResponse.json({ success: true });
  }

  // Already recorded — skip DB writes on refresh / high traffic.
  if (signer && (signer.status === "Signed" || (signer.status === "Viewed" && signer.viewedAt))) {
    return NextResponse.json({ success: true, skipped: true });
  }

  const now = new Date();
  if (signer && signer.status !== "Signed") {
    await prisma.shmDocumentSigner.update({
      where: { id: signer.id },
      data: { status: "Viewed", viewedAt: now, openedAt: signer.openedAt || now },
    });
  }

  if (!["Signed", "Make Error"].includes(doc.status) && !(doc.status === "Processing" && !isOwnershipStatement(doc.documentType))) {
    const signers = await prisma.shmDocumentSigner.findMany({ where: { documentId: doc.documentId } });
    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: { status: rollupDocumentStatus(signers, doc.status, doc.documentType), viewedAt: now, openedAt: doc.openedAt || now },
    });
  }

  await logShmEvent(doc.documentId, `${signer?.signerType || "signer"}_viewed`, request);
  return NextResponse.json({ success: true });
}
