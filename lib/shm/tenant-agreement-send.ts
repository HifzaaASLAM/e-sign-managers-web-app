import { prisma } from "../prisma";

/** Mark tenant recipient as emailed only after Resend accepts the message. */
export async function markTenantSigningEmailDelivered(documentId: string) {
  const now = new Date();
  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      tenantSentAt: now,
      sentAt: now,
    },
  });
  await prisma.shmDocumentSigner.updateMany({
    where: { documentId, signerType: "recipient" },
    data: {
      status: "Sent",
      sentAt: now,
    },
  });
}

export async function markTenantSigningEmailFailed(documentId: string) {
  await prisma.shmDocumentSigner.updateMany({
    where: { documentId, signerType: "recipient" },
    data: {
      status: "Email failed",
      sentAt: null,
    },
  });
}

export async function markRecipientSigningEmailDelivered(documentId: string, email: string) {
  const now = new Date();
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return;
  await prisma.shmDocumentSigner.updateMany({
    where: { documentId, signerType: "recipient", email: normalized },
    data: { status: "Sent", sentAt: now },
  });
  await prisma.shmDocument.update({
    where: { documentId },
    data: { sentAt: now, tenantSentAt: now },
  });
}

export async function markRecipientSigningEmailFailed(documentId: string, email: string) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return;
  await prisma.shmDocumentSigner.updateMany({
    where: { documentId, signerType: "recipient", email: normalized },
    data: { status: "Email failed", sentAt: null },
  });
}
