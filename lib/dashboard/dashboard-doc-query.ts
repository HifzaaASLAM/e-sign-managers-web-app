import type { Prisma } from "@prisma/client";

/** Fields needed for dashboard list serialization — excludes signature blobs and tokens. */
export const dashboardDocumentListSelect = {
  id: true,
  documentId: true,
  documentType: true,
  propertyAddress: true,
  status: true,
  recipientName: true,
  recipientEmail: true,
  recipientRole: true,
  adminName: true,
  adminEmail: true,
  adminToken: true,
  adminSignedAt: true,
  tenantSignedAt: true,
  signedAt: true,
  viewedAt: true,
  openedAt: true,
  sentAt: true,
  signingUrl: true,
  signedDriveUrl: true,
  createdAt: true,
  signers: {
    orderBy: { signerType: "asc" as const },
    select: {
      signerType: true,
      name: true,
      email: true,
      role: true,
      status: true,
      signingUrl: true,
      token: true,
      viewedAt: true,
      openedAt: true,
      signedAt: true,
      sentAt: true,
    },
  },
} satisfies Prisma.ShmDocumentSelect;

export const DASHBOARD_DOCUMENT_LIST_LIMIT = 50;
