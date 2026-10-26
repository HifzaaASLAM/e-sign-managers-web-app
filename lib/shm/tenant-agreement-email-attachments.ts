import {
  buildTenantAgreementTemplateData,
  generateTenantAgreementDocxBase64,
} from "./tenant-agreement-export";

function pickString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Word copy of the creator-signed agreement for the tenant signing email. */
export async function buildTenantAgreementSigningEmailAttachments(input: {
  documentId: string;
  agreementData: Record<string, unknown>;
  adminSignature: string;
  propertyAddress?: string | null;
  adminName?: string | null;
  adminEmail?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
}) {
  const merged: Record<string, unknown> = { ...input.agreementData };

  merged.tenant_name = pickString(merged.tenant_name, merged.tenant_name_field, input.tenantName);
  merged.tenant_email = pickString(merged.tenant_email, merged.tenant_email_field, input.tenantEmail);
  merged.provider_name = pickString(merged.provider_name);
  merged.provider_email = pickString(merged.provider_email);
  merged.premises_address = pickString(merged.premises_address, input.propertyAddress);

  const rebuilt = buildTenantAgreementTemplateData(merged, {
    documentId: input.documentId,
    signedAt: new Date(),
  });

  const hasTermArray = Array.isArray(merged.additional_terms) && (merged.additional_terms as unknown[]).length > 0;
  const hasRuleArray = Array.isArray(merged.share_house_rules) && (merged.share_house_rules as unknown[]).length > 0;
  const hasCoreArray = Array.isArray(merged.core_sections) && (merged.core_sections as unknown[]).length > 0;
  merged.core_sections_text = hasCoreArray ? rebuilt.core_sections : pickString(merged.core_sections_text);
  merged.additional_terms_text = hasTermArray ? rebuilt.additional_terms : pickString(merged.additional_terms_text);
  merged.additional_share_house_rules = hasRuleArray
    ? rebuilt.additional_share_house_rules
    : pickString(merged.additional_share_house_rules);

  const generated = await generateTenantAgreementDocxBase64(merged, {
    documentId: input.documentId,
    providerSignature: input.adminSignature,
    signedAt: new Date(),
  });

  const safeId = input.documentId.replace(/[^\w-]/g, "") || "document";
  const ext = generated.isPdf ? "pdf" : "docx";
  return [
    {
      fileName: `Tenant-Agreement-${safeId}.${ext}`,
      fileContent: generated.base64,
      fileType: generated.mimeType,
    },
  ];
}

const ATTACHMENT_BUILD_TIMEOUT_MS = 12_000;

/** Link-only signing emails match Tenant Application reliability; set TA_SIGNING_EMAIL_ATTACH_DOCX=true to attach .docx. */
export function tenantAgreementSigningEmailAttachmentsEnabled() {
  return process.env.TA_SIGNING_EMAIL_ATTACH_DOCX === "true";
}

/** Tenant-signed copy for the info@ notification (prefers browser-submitted file). */
export async function buildTenantAgreementTenantSignedNotificationAttachment(
  input: {
    documentId: string;
    agreementData: Record<string, unknown>;
    tenantSignature: string;
    propertyAddress?: string | null;
    tenantName?: string | null;
    tenantEmail?: string | null;
    adminSignature?: string | null;
    submittedFile?: { fileName: string; fileContent: string; fileType: string };
  },
) {
  const submitted = input.submittedFile?.fileContent?.trim();
  if (submitted) {
    const fileName = input.submittedFile?.fileName || `Tenant-Agreement-${input.documentId}.docx`;
    const fileType =
      input.submittedFile?.fileType
      || (fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return [
      {
        fileName,
        fileContent: submitted.replace(/^data:[^;]+;base64,/, ""),
        fileType,
      },
    ];
  }

  const merged: Record<string, unknown> = { ...input.agreementData };
  merged.tenant_name = pickString(merged.tenant_name, merged.tenant_name_field, input.tenantName);
  merged.tenant_email = pickString(merged.tenant_email, merged.tenant_email_field, input.tenantEmail);
  merged.premises_address = pickString(merged.premises_address, input.propertyAddress);

  const generated = await generateTenantAgreementDocxBase64(merged, {
    documentId: input.documentId,
    tenantSignature: input.tenantSignature || undefined,
    providerSignature: input.adminSignature || undefined,
    signedAt: new Date(),
  });

  const safeId = input.documentId.replace(/[^\w-]/g, "") || "document";
  const ext = generated.isPdf ? "pdf" : "docx";
  return [
    {
      fileName: `Tenant-Agreement-${safeId}-tenant-signed.${ext}`,
      fileContent: generated.base64,
      fileType: generated.mimeType,
    },
  ];
}

export async function loadTenantAgreementEmailAttachmentsForSend(
  input: Parameters<typeof buildTenantAgreementSigningEmailAttachments>[0],
) {
  if (!tenantAgreementSigningEmailAttachmentsEnabled()) {
    return [];
  }
  try {
    const built = await Promise.race([
      buildTenantAgreementSigningEmailAttachments(input),
      new Promise<[]>((resolve) => {
        setTimeout(() => {
          console.warn("[tenant-agreement-email-attachments] build timed out; sending email without attachment");
          resolve([]);
        }, ATTACHMENT_BUILD_TIMEOUT_MS);
      }),
    ]);
    return built;
  } catch (error) {
    console.error("[tenant-agreement-email-attachments] build failed", error);
    return [];
  }
}
