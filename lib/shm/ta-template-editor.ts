import type { TaTemplateAgreementData } from "./ta-templates";
import {
  IMPORTED_DOCX_B64_KEY,
  IMPORTED_DOCX_NAME_KEY,
  IMPORTED_DOCUMENT_FORMAT_KEY,
  IMPORTED_PDF_B64_KEY,
  IMPORTED_PDF_NAME_KEY,
  isImportedTenantAgreementTemplate,
} from "./ta-imported-document";

const IMPORT_B64_KEYS = [IMPORTED_DOCX_B64_KEY, IMPORTED_PDF_B64_KEY] as const;

/** True when the template has clause-builder content saved (not import-only). */
export function hasStructuredTenantAgreementTemplateContent(data: Record<string, unknown>): boolean {
  const core = data.core_sections;
  if (Array.isArray(core) && core.length > 0) return true;
  const additional = data.additional_terms;
  if (Array.isArray(additional) && additional.length > 0) return true;
  const rules = data.share_house_rules;
  if (Array.isArray(rules) && rules.length > 0) return true;
  const coreText = String(data.core_sections_text || "").trim();
  if (coreText) return true;
  const additionalText = String(data.additional_terms_text || "").trim();
  if (additionalText) return true;
  return false;
}

/** Strip large import payloads before embedding agreement data in the template editor iframe. */
export function stripImportedDocumentBinaryFields(data: TaTemplateAgreementData): TaTemplateAgreementData {
  const out = { ...data };
  for (const key of IMPORT_B64_KEYS) delete out[key];
  return out;
}

/**
 * Agreement data passed into the 3-step template editor.
 * Pure imports only carry landlord/premises metadata; the wizard loads default clauses client-side.
 */
export function prepareAgreementDataForTemplateEditor(
  raw: TaTemplateAgreementData,
  options?: { adminEmail?: string },
): TaTemplateAgreementData {
  const data = stripImportedDocumentBinaryFields(raw);
  const structured = hasStructuredTenantAgreementTemplateContent(data);

  if (structured) {
    return data;
  }

  if (!isImportedTenantAgreementTemplate(raw)) {
    return data;
  }

  const providerName = String(data.provider_name || "").trim();
  const premises = String(data.premises_address || "").trim();
  const providerEmail = String(data.provider_email || options?.adminEmail || "").trim();

  const hydrated: TaTemplateAgreementData = {};
  if (providerName) hydrated.provider_name = providerName;
  if (premises) hydrated.premises_address = premises;
  if (providerEmail) hydrated.provider_email = providerEmail;

  return hydrated;
}

/** After saving from the clause wizard, persist structured data and drop import-only metadata. */
export function mergeTemplateAgreementDataOnSave(
  existingRaw: TaTemplateAgreementData,
  incoming: TaTemplateAgreementData,
): TaTemplateAgreementData {
  const merged = { ...incoming };

  if (!hasStructuredTenantAgreementTemplateContent(merged)) {
    return { ...existingRaw, ...merged };
  }

  const keepImportedMeta = existingRaw.imported_document === true;
  if (!keepImportedMeta) {
    delete merged.imported_document;
    delete merged[IMPORTED_DOCUMENT_FORMAT_KEY];
  }
  delete merged[IMPORTED_DOCX_B64_KEY];
  delete merged[IMPORTED_DOCX_NAME_KEY];
  delete merged[IMPORTED_PDF_B64_KEY];
  delete merged[IMPORTED_PDF_NAME_KEY];

  return merged;
}

export function templateDescriptionLooksImported(description: string | null | undefined) {
  return String(description || "").toLowerCase().includes("imported document");
}

/** Templates created via Import document (even if later edited or binaries trimmed). */
export function templateListShowsAsImportedDocument(
  data: Record<string, unknown>,
  description?: string | null,
): boolean {
  if (data.imported_document === true) return true;
  if (templateDescriptionLooksImported(description)) return true;
  if (!isImportedTenantAgreementTemplate(data)) return false;
  return !hasStructuredTenantAgreementTemplateContent(data);
}
