import { prisma } from "../prisma";
import { createShmDocument, type CreateShmDocumentInput } from "../shm/create-shm-document";
import { computeReadinessScore } from "./readiness";
import { isApplicationDecision, type ApplicationDecision } from "./constants";
import { linkDocumentToApplication } from "./link";
import { getAppUrl } from "../shm/documents";

export async function addJointApplicant(input: {
  applicationId: string;
  companyId: string;
  user: CreateShmDocumentInput["user"];
  name: string;
  email: string;
  request?: Request;
}) {
  const application = await prisma.rentalApplication.findFirst({
    where: { id: input.applicationId, companyId: input.companyId },
  });
  if (!application) throw new Error("Application not found.");

  const created = await createShmDocument({
    companyId: input.companyId,
    user: input.user,
    documentType: "Tenant Application",
    recipientName: input.name,
    recipientEmail: input.email,
    recipientRole: "Tenant",
    propertyAddress: application.propertyAddress,
    request: input.request,
    rentalApplicationId: application.id,
  });

  return { application, document: created };
}

export async function setApplicationDecision(
  applicationId: string,
  companyId: string,
  decision: string,
) {
  if (!isApplicationDecision(decision)) {
    throw new Error("Invalid decision status.");
  }
  return prisma.rentalApplication.updateMany({
    where: { id: applicationId, companyId },
    data: { decisionStatus: decision as ApplicationDecision },
  });
}

export async function refreshApplicationReadiness(applicationId: string) {
  const links = await prisma.rentalApplicationDocument.findMany({
    where: { applicationId },
  });
  if (links.length === 0) {
    await prisma.rentalApplication.update({
      where: { id: applicationId },
      data: { readinessScore: 0 },
    });
    return 0;
  }

  const docs = await prisma.shmDocument.findMany({
    where: { documentId: { in: links.map((l) => l.documentId) } },
    select: {
      documentId: true,
      agreementData: true,
      tenantSignature: true,
      signedAt: true,
      tenantSignedAt: true,
    },
  });

  const scores = docs.map((doc) =>
    computeReadinessScore(doc.agreementData, {
      hasSignature: Boolean(doc.tenantSignature || doc.signedAt || doc.tenantSignedAt),
    }),
  );
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  await prisma.rentalApplication.update({
    where: { id: applicationId },
    data: { readinessScore: avg },
  });
  return avg;
}

export async function getApplicationBundle(applicationId: string, companyId: string) {
  return prisma.rentalApplication.findFirst({
    where: { id: applicationId, companyId },
    include: {
      documents: {
        orderBy: { createdAt: "asc" },
        include: { applicantProfile: true },
      },
    },
  });
}

export function getApplyUrl(inviteToken: string) {
  return `${getAppUrl()}/apply/${inviteToken}`;
}

export { linkDocumentToApplication };
