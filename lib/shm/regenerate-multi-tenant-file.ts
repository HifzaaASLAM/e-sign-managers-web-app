import { prisma } from "../prisma";
import {
  generateTenantAgreementDocxBase64,
  buildTenantAgreementTemplateData,
} from "./tenant-agreement-export";
import {
  isDualRentalProviderTenantSign,
  isMultiTenantAgreementData,
  rentalProviderSignatureFromSigners,
  tenantSignatureRecordsFromSigners,
} from "./multi-tenant-signatures";

function parseAgreementData(raw: string | null) {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Build one shared agreement file with every tenant signature collected so far. */
export async function regenerateMultiTenantCombinedFile(documentId: string) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc) return null;

  const agreementData = parseAgreementData(doc.agreementData);
  const recipientCount = doc.signers.filter(
    (s) => s.signerType === "recipient" && s.status !== "Removed",
  ).length;
  if (!isMultiTenantAgreementData(agreementData) && !(recipientCount > 1 && isDualRentalProviderTenantSign(agreementData))) {
    return null;
  }

  const tenantSignatures = tenantSignatureRecordsFromSigners(doc.signers);
  const providerSignature =
    rentalProviderSignatureFromSigners(doc.signers, agreementData) || doc.adminSignature || undefined;
  const tenantSignature =
    tenantSignatures.find((row) => row.signature)?.signature || doc.tenantSignature || undefined;
  const mergedData: Record<string, unknown> = { ...agreementData };
  const rebuilt = buildTenantAgreementTemplateData(mergedData, {
    documentId: doc.documentId,
    signedAt: new Date(),
  });
  mergedData.core_sections_text = rebuilt.core_sections;
  mergedData.additional_terms_text = rebuilt.additional_terms;
  mergedData.additional_share_house_rules = rebuilt.additional_share_house_rules;

  let generated;
  try {
    generated = await generateTenantAgreementDocxBase64(mergedData, {
      documentId: doc.documentId,
      tenantSignature,
      providerSignature,
      signedAt: new Date(),
      tenantSignatures,
      providerName: String(mergedData.provider_name || ""),
      providerEmail: String(mergedData.provider_email || ""),
      multiTenant: true,
      signers: doc.signers.map((s) => ({
        signerType: s.signerType,
        role: s.role,
        name: s.name,
        email: s.email,
        status: s.status,
      })),
    });
  } catch (error) {
    console.error("[regenerate-multi-tenant-file]", error);
    return null;
  }

  return {
    fileContent: generated.base64,
    fileType: generated.mimeType,
    fileName: `Tenant-Agreement-${documentId}-all-tenants.${generated.isPdf ? "pdf" : "docx"}`,
    isPdf: generated.isPdf,
  };
}
