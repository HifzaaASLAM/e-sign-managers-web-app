import { createToken } from "../shm/documents";
import { prisma } from "../prisma";

export async function findApplicationForDocument(documentId: string) {
  const link = await prisma.rentalApplicationDocument.findFirst({
    where: { documentId },
    include: { application: true },
  });
  return link?.application ?? null;
}

export async function linkDocumentToApplication(input: {
  applicationId: string;
  documentId: string;
  isPrimary?: boolean;
  applicantProfileId?: string | null;
}) {
  return prisma.rentalApplicationDocument.upsert({
    where: {
      applicationId_documentId: {
        applicationId: input.applicationId,
        documentId: input.documentId,
      },
    },
    create: {
      applicationId: input.applicationId,
      documentId: input.documentId,
      isPrimary: Boolean(input.isPrimary),
      applicantProfileId: input.applicantProfileId || null,
    },
    update: {
      isPrimary: Boolean(input.isPrimary),
      ...(input.applicantProfileId !== undefined
        ? { applicantProfileId: input.applicantProfileId }
        : {}),
    },
  });
}

export async function createRentalApplication(input: {
  companyId: string;
  createdById?: string | null;
  propertyAddress: string;
  title?: string;
  inviteEnabled?: boolean;
}) {
  const inviteToken = input.inviteEnabled === false ? null : createToken().slice(0, 24);
  return prisma.rentalApplication.create({
    data: {
      companyId: input.companyId,
      createdById: input.createdById || null,
      propertyAddress: input.propertyAddress.trim(),
      title: input.title?.trim() || null,
      decisionStatus: "Under review",
      readinessScore: 0,
      inviteToken,
      inviteEnabled: input.inviteEnabled !== false,
    },
  });
}

/** When a Tenant Application doc is created, attach it to an application campaign. */
export async function ensureApplicationForTenantDocument(input: {
  companyId: string;
  createdById?: string | null;
  documentId: string;
  propertyAddress: string;
  recipientName: string;
  recipientEmail: string;
  rentalApplicationId?: string | null;
  applicantProfileId?: string | null;
}) {
  let application =
    input.rentalApplicationId
      ? await prisma.rentalApplication.findFirst({
          where: { id: input.rentalApplicationId, companyId: input.companyId },
        })
      : null;

  if (!application) {
    application = await createRentalApplication({
      companyId: input.companyId,
      createdById: input.createdById,
      propertyAddress: input.propertyAddress,
      title: `${input.recipientName} — ${input.propertyAddress}`.slice(0, 180),
      inviteEnabled: true,
    });
  }

  const existingLinks = await prisma.rentalApplicationDocument.count({
    where: { applicationId: application.id },
  });

  await linkDocumentToApplication({
    applicationId: application.id,
    documentId: input.documentId,
    isPrimary: existingLinks === 0,
    applicantProfileId: input.applicantProfileId,
  });

  if (input.recipientEmail) {
    const email = input.recipientEmail.toLowerCase();
    const parts = input.recipientName.trim().split(/\s+/);
    await prisma.applicantProfile.upsert({
      where: {
        companyId_email: {
          companyId: input.companyId,
          email,
        },
      },
      create: {
        companyId: input.companyId,
        email,
        firstName: parts[0] || input.recipientName,
        lastName: parts.slice(1).join(" ") || "",
        profileData: JSON.stringify({
          e_first: parts[0] || "",
          e_last: parts.slice(1).join(" ") || "",
          e_email: email,
        }),
      },
      update: {},
    });
  }

  return application;
}
