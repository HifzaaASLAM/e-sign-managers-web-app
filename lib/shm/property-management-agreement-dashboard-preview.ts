import { prisma } from "../prisma";
import { generatePropertyManagementAgreementBuiltDocx } from "./property-management-agreement-built-docx";
import {
  parsePmaAgreementData,
  pmaMergedFieldValuesForPrefill,
} from "./property-management-agreement-fields";
import { resolvePmaSignatureDataUrls } from "./property-management-agreement-signatures";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Build dashboard download/preview for Property Management Agreement (.docx). */
export async function buildPropertyManagementAgreementDashboardPreview(
  documentId: string,
  preferred: "pdf" | "docx" = "docx",
) {
  if (preferred !== "docx") return null;

  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || doc.documentType.toLowerCase() !== "property management agreement") return null;

  const agreementData = pmaMergedFieldValuesForPrefill(parsePmaAgreementData(doc.agreementData));
  const recipient = doc.signers.find((s) => s.signerType === "recipient" && s.status !== "Removed");
  const creator = doc.signers.find((s) => s.signerType === "creator");

  if (!agreementData.owner && recipient?.name) agreementData.owner = recipient.name;
  if (!agreementData.email && recipient?.email) agreementData.email = recipient.email;
  if (!agreementData.property && doc.propertyAddress) agreementData.property = doc.propertyAddress;

  const { ownerSignature, agentSignature } = await resolvePmaSignatureDataUrls({
    signers: doc.signers,
    doc,
    agreementData,
  });

  if (!agreementData.submittedAt) {
    agreementData.submittedAt =
      doc.signedAt?.toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })
      || new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
  }

  const buffer = await generatePropertyManagementAgreementBuiltDocx(agreementData, {
    ownerSignature: ownerSignature || undefined,
    agentSignature: agentSignature || undefined,
  });

  if (!buffer.length) return null;

  const ownerName = String(
    agreementData.owner_sign_name || agreementData.owner || recipient?.name || "Owner",
  )
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const dateStr = new Date().toISOString().slice(0, 10);

  return {
    buffer,
    fileType: DOCX_MIME,
    fileName: `Property-Management-Agreement-${ownerName || "Owner"}-${dateStr}.docx`,
  };
}
