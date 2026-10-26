import { prisma } from "../prisma";
import { createToken, getSignUrl } from "../shm/documents";

function signerStatusFromDocFields(input: {
  signedAt: Date | null;
  viewedAt: Date | null;
  openedAt: Date | null;
  sentAt: Date | null;
  fallbackSigned?: boolean;
}) {
  if (input.signedAt || input.fallbackSigned) return "Signed";
  if (input.viewedAt) return "Viewed";
  if (input.openedAt) return "Opened";
  if (input.sentAt) return "Sent";
  return "Not Sent";
}

/** One-time safe repair: older documents may lack `ShmDocumentSigner` rows; dashboard audit needs them. */
export async function backfillMissingSignersForDocuments(documentIds: string[]) {
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return;

  const docs = await prisma.shmDocument.findMany({
    where: { documentId: { in: ids } },
    include: { signers: { select: { id: true } } },
  });

  for (const doc of docs) {
    if (doc.signers.length > 0) continue;

    const rows: Array<{
      id: string;
      documentId: string;
      name: string;
      email: string;
      role: string;
      signerType: string;
      token: string;
      signingUrl: string | null;
      status: string;
      sentAt: Date | null;
      openedAt: Date | null;
      viewedAt: Date | null;
      signedAt: Date | null;
    }> = [];

    const creatorToken = doc.adminToken?.trim();
    if (creatorToken && doc.adminEmail) {
      rows.push({
        id: createToken(),
        documentId: doc.documentId,
        name: doc.adminName || "Creator",
        email: doc.adminEmail,
        role: "Creator",
        signerType: "creator",
        token: creatorToken,
        signingUrl: getSignUrl(doc.documentId, creatorToken, "creator"),
        status: doc.adminSignedAt ? "Signed" : "Not Signed",
        sentAt: doc.sentAt,
        openedAt: doc.openedAt,
        viewedAt: doc.viewedAt,
        signedAt: doc.adminSignedAt,
      });
    }

    const recipientToken = (doc.tenantToken || doc.token)?.trim();
    if (recipientToken && doc.recipientEmail) {
      rows.push({
        id: createToken(),
        documentId: doc.documentId,
        name: doc.recipientName,
        email: doc.recipientEmail,
        role: doc.recipientRole || "Recipient",
        signerType: "recipient",
        token: recipientToken,
        signingUrl: doc.signingUrl || doc.tenantSigningUrl || getSignUrl(doc.documentId, recipientToken, "recipient"),
        status: signerStatusFromDocFields({
          signedAt: doc.signedAt || doc.tenantSignedAt,
          viewedAt: doc.viewedAt,
          openedAt: doc.openedAt,
          sentAt: doc.sentAt || doc.tenantSentAt,
        }),
        sentAt: doc.sentAt || doc.tenantSentAt,
        openedAt: doc.openedAt,
        viewedAt: doc.viewedAt,
        signedAt: doc.signedAt || doc.tenantSignedAt,
      });
    }

    if (rows.length === 0) continue;
    await prisma.shmDocumentSigner.createMany({ data: rows, skipDuplicates: true });
  }
}
