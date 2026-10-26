import { randomBytes } from "crypto";
import { prisma } from "../prisma";

function revokedToken() {
  return `revoked-${randomBytes(32).toString("hex")}`;
}

/** Revoke one signer's token (multi-tenant agreements keep other recipient links active). */
export async function revokeSignerTokenById(signerId: string) {
  const revokedTokenValue = revokedToken();
  await prisma.shmDocumentSigner.update({
    where: { id: signerId },
    data: { token: revokedTokenValue, signingUrl: null },
  });
}

/** Revoke a signer's link after they sign so the URL cannot be reused or forwarded. */
export async function revokeSignerAccess(documentId: string, signerType: "creator" | "recipient", signerId?: string) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc) return;

  const recipients = doc.signers.filter((item) => item.signerType === "recipient" && item.status !== "Removed");
  if (signerType === "recipient" && recipients.length > 1 && signerId) {
    await revokeSignerTokenById(signerId);
    return;
  }

  const signer = signerId
    ? doc.signers.find((item) => item.id === signerId)
    : doc.signers.find((item) => item.signerType === signerType);
  const revokedTokenValue = revokedToken();

  if (signer) {
    await prisma.shmDocumentSigner.update({
      where: { id: signer.id },
      data: { token: revokedTokenValue, signingUrl: null },
    });
  }

  if (signerType === "creator") {
    await prisma.shmDocument.update({
      where: { documentId },
      data: { adminToken: null },
    });
    return;
  }

  await prisma.shmDocument.update({
    where: { documentId },
    data: {
      tenantToken: null,
      tenantSigningUrl: null,
      token: doc.adminToken ?? null,
      signingUrl: doc.signedDriveUrl ?? null,
    },
  });
}

export function isRevokedToken(token: string) {
  return token.startsWith("revoked-");
}
