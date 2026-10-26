import { prisma } from "../prisma";
import {
  buildTenantAgreementTemplateData,
  generateTenantAgreementDocxBase64,
} from "./tenant-agreement-export";
import {
  isDualRentalProviderTenantSign,
  isMultiTenantAgreementData,
  rentalProviderFromAgreementData,
  rentalProviderSignatureFromSigners,
  tenantSignatureRecordsFromSigners,
} from "./multi-tenant-signatures";
import { convertDocxBufferToPdf } from "./docx-to-pdf";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function parseAgreementData(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeAgreementLists(agreementData: Record<string, unknown>) {
  const normalizeList = (value: unknown) => (Array.isArray(value) ? value : []);
  agreementData.core_sections = normalizeList(agreementData.core_sections);
  agreementData.additional_terms = normalizeList(agreementData.additional_terms);
  agreementData.share_house_rules = normalizeList(agreementData.share_house_rules);

  const isSelected = (row: Record<string, unknown>) =>
    row && row.selected !== false && row.selected !== "false" && row.selected !== 0;

  agreementData.core_sections_text = (agreementData.core_sections as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row))
    .map((row) => {
      const title = String(row.title || "").trim();
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_terms_text = (agreementData.additional_terms as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row))
    .map((row) => {
      const title = String(row.title || "").trim();
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_share_house_rules = (agreementData.share_house_rules as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row) && String(row.text || "").trim())
    .map((row, idx) => `${idx + 1}. ${String(row.text || "").trim()}`)
    .join("\n\n");

  return agreementData;
}

/** Build dashboard preview from current agreement data (Details + Terms + signatures). */
export async function buildTenantAgreementDashboardPreview(
  documentId: string,
  preferred: "pdf" | "docx" = "pdf",
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || doc.documentType.toLowerCase() !== "tenant agreement") return null;

  const agreementData = normalizeAgreementLists(parseAgreementData(doc.agreementData));
  const recipientCount = doc.signers.filter(
    (s) => s.signerType === "recipient" && s.status !== "Removed",
  ).length;
  const multiTenant =
    isMultiTenantAgreementData(agreementData) ||
    (recipientCount > 1 && isDualRentalProviderTenantSign(agreementData));

  const tenantSignatures = tenantSignatureRecordsFromSigners(doc.signers);
  const providerSignature =
    rentalProviderSignatureFromSigners(doc.signers, agreementData) || undefined;
  const rentalProvider = rentalProviderFromAgreementData(agreementData);

  const tenantFromSigners = doc.signers.find(
    (s) =>
      s.signerType === "recipient" &&
      s.status === "Signed" &&
      !/rental provider/i.test(String(s.role || "")) &&
      String(s.signature || "").trim(),
  );

  const rebuilt = buildTenantAgreementTemplateData(agreementData, {
    documentId: doc.documentId,
    signedAt: new Date(),
  });
  agreementData.core_sections_text = rebuilt.core_sections;
  agreementData.additional_terms_text = rebuilt.additional_terms;
  agreementData.additional_share_house_rules = rebuilt.additional_share_house_rules;

  const signerRows = doc.signers.map((s) => ({
    signerType: s.signerType,
    role: s.role,
    name: s.name,
    email: s.email,
    status: s.status,
  }));

  const generated = await generateTenantAgreementDocxBase64(agreementData, {
    documentId: doc.documentId,
    signers: signerRows,
    tenantSignature: String(
      tenantFromSigners?.signature ||
        doc.tenantSignature ||
        tenantSignatures[tenantSignatures.length - 1]?.signature ||
        "",
    ),
    providerSignature,
    signedAt: new Date(),
    tenantSignatures,
    providerName: String(agreementData.provider_name || rentalProvider?.name || ""),
    providerEmail: String(agreementData.provider_email || rentalProvider?.email || ""),
    multiTenant,
  });

  let buffer = Buffer.from(generated.base64, "base64");
  let mimeType = generated.mimeType;
  let fileName = `Tenant-Agreement-${documentId}-preview.${generated.isPdf ? "pdf" : "docx"}`;

  if (preferred === "pdf" && !generated.isPdf) {
    const converted = await convertDocxBufferToPdf(buffer, fileName);
    if (converted) {
      buffer = converted;
      mimeType = PDF_MIME;
      fileName = `Tenant-Agreement-${documentId}-preview.pdf`;
    }
  }

  if (!buffer.length) return null;

  return { buffer, fileType: mimeType, fileName };
}
