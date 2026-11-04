import { prisma } from "../prisma";
import {
  decodeStoredFileContent,
  getStoredSubmission,
  pickStoredPreviewFile,
} from "../dashboard/document-file";
import { convertDocxBufferToPdf } from "./docx-to-pdf";
import { generatePropertyManagementAgreementBuiltDocx } from "./property-management-agreement-built-docx";
import {
  parsePmaAgreementData,
  pmaMergedFieldValuesForPrefill,
} from "./property-management-agreement-fields";
import { resolvePmaSignatureDataUrls } from "./property-management-agreement-signatures";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isDocxZipBuffer(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Build dashboard download/preview for Property Management Agreement. PDF preferred for View (matches Word). */
export async function buildPropertyManagementAgreementDashboardPreview(
  documentId: string,
  preferred: "pdf" | "docx" = "docx",
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || doc.documentType.toLowerCase() !== "property management agreement") return null;

  const agreementData = pmaMergedFieldValuesForPrefill(parsePmaAgreementData(doc.agreementData));
  const recipient = doc.signers.find((s) => s.signerType === "recipient" && s.status !== "Removed");

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

  const ownerName = String(
    agreementData.owner_sign_name || agreementData.owner || recipient?.name || "Owner",
  )
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const dateStr = new Date().toISOString().slice(0, 10);
  const baseName = `Property-Management-Agreement-${ownerName || "Owner"}-${dateStr}`;

  // Prefer the exact final DOCX already produced on sign (same as Download / email).
  let buffer: Buffer | null = null;
  const submission = getStoredSubmission(doc.agreementData);
  const stored = submission ? pickStoredPreviewFile(submission, "docx") : null;
  if (stored?.fileContent) {
    const decoded = decodeStoredFileContent(stored.fileContent);
    if (isDocxZipBuffer(decoded)) buffer = decoded;
  }

  if (!buffer?.length) {
    buffer = await generatePropertyManagementAgreementBuiltDocx(agreementData, {
      ownerSignature: ownerSignature || undefined,
      agentSignature: agentSignature || undefined,
    });
  }

  if (!buffer?.length) return null;

  if (preferred === "pdf") {
    const converted = await convertDocxBufferToPdf(buffer, `${baseName}.docx`);
    if (converted?.length) {
      return {
        buffer: converted,
        fileType: PDF_MIME,
        fileName: `${baseName}.pdf`,
      };
    }
  }

  return {
    buffer,
    fileType: DOCX_MIME,
    fileName: `${baseName}.docx`,
  };
}
