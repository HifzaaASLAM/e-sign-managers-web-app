import { prisma } from "../prisma";
import { isOwnershipStatement, logShmEvent, rollupDocumentStatus, validateShmSignerToken } from "./documents";

export async function markOwnershipStatementOwnerViewed(documentId: string, token: string, request?: Request) {
  const validation = await validateShmSignerToken(documentId, token);
  if (!validation?.document) return false;

  const { document: doc, signer } = validation;
  if (!isOwnershipStatement(doc.documentType)) return false;
  if (signer?.signerType !== "recipient") return false;

  const now = new Date();
  if (signer.status !== "Viewed" && signer.status !== "Opened" && signer.status !== "Signed") {
    await prisma.shmDocumentSigner.update({
      where: { id: signer.id },
      data: { status: "Viewed", viewedAt: now, openedAt: signer.openedAt || now },
    });
  }

  const signers = await prisma.shmDocumentSigner.findMany({ where: { documentId } });
  if (!doc.signedDriveUrl && doc.status !== "Signed" && doc.status !== "Make Error") {
    await prisma.shmDocument.update({
      where: { documentId },
      data: {
        status: rollupDocumentStatus(signers, doc.status, doc.documentType),
        viewedAt: now,
        openedAt: doc.openedAt || now,
      },
    });
  }

  await logShmEvent(documentId, "owner_viewed", request);
  return true;
}

export function resolveOwnershipStatementDocumentStatus(
  docStatus: string,
  signedDriveUrl: string | null,
  recipientStatus: string,
  adminDeliveryComplete: boolean,
) {
  if (docStatus === "Make Error") return "Make Error";
  if (signedDriveUrl) return "Signed";
  if (!adminDeliveryComplete) return docStatus;
  if (recipientStatus === "Viewed" || recipientStatus === "Opened") return "Viewed";
  return "Sent";
}
