import { generateTenantAgreementDocx } from "./tenant-agreement-docx";
import type { TenantSignatureRecord } from "./multi-tenant-signatures";
import { finalizeMultiTenantDocument } from "./tenant-agreement-multi-export";
import { applyShmBrandingToImportedPdfBuffer } from "./tenant-agreement-pdf-branding";
import {
  formatRentersEmailsForConsentClause,
  formatRentersEmailsForPartiesSection,
  formatRentersNamesForPartiesSection,
  formatRentersRosterLabel,
  landlordFromAgreementData,
  resolveRentersForExport,
  rentersFromAgreementData,
} from "./multi-tenant-signatures";
import {
  getImportedDocxBuffer,
  getImportedPdfBuffer,
  IMPORTED_DOCX_B64_KEY,
  IMPORTED_DOCUMENT_FORMAT_KEY,
  IMPORTED_DOCX_NAME_KEY,
  IMPORTED_PDF_B64_KEY,
  IMPORTED_PDF_NAME_KEY,
  isImportedTenantAgreementTemplate,
} from "./ta-imported-document";

/** Creator-filled agreements should export from the Word template, not a static imported PDF snapshot. */
export function shouldUseNativeTenantAgreementTemplate(data: Record<string, unknown>) {
  if (!isImportedTenantAgreementTemplate(data)) return true;
  if (data.multi_tenant_send === true) return true;
  if (Array.isArray(data.core_sections) && (data.core_sections as unknown[]).length > 0) return true;
  if (String(data.core_sections_text || "").trim()) return true;
  if (Array.isArray(data.additional_terms) && (data.additional_terms as unknown[]).length > 0) return true;
  if (String(data.additional_terms_text || "").trim()) return true;
  if (String(data.premises_address || "").trim()) return true;
  return false;
}

export function agreementDataForNativeTenantExport(data: Record<string, unknown>) {
  if (!shouldUseNativeTenantAgreementTemplate(data)) return data;
  const copy = { ...data };
  delete copy.imported_document;
  delete copy[IMPORTED_PDF_B64_KEY];
  delete copy[IMPORTED_DOCX_B64_KEY];
  delete copy[IMPORTED_PDF_NAME_KEY];
  delete copy[IMPORTED_DOCX_NAME_KEY];
  delete copy[IMPORTED_DOCUMENT_FORMAT_KEY];
  return copy;
}

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function formatDateAu(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

function formatSignedDateTime(value?: Date) {
  const date = value || new Date();
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildTenantAgreementTemplateData(
  data: Record<string, unknown>,
  extras?: { documentId?: string; signedAt?: Date; signers?: Parameters<typeof resolveRentersForExport>[1] },
) {
  const agreementDate = formatDateAu(data.agreement_date) || formatDateAu(new Date().toISOString().slice(0, 10));
  const renters = resolveRentersForExport(data, extras?.signers);
  let tenantName = str(data.tenant_name || data.tenant_name_field);
  let tenantEmail = str(data.tenant_email || data.tenant_email_field);
  let tenantEmailConsent = tenantEmail;

  if (renters.length >= 2) {
    tenantName = formatRentersNamesForPartiesSection(renters);
    tenantEmail = formatRentersEmailsForPartiesSection(renters);
    tenantEmailConsent = formatRentersEmailsForConsentClause(renters);
  } else if (renters.length === 1) {
    tenantName = renters[0].name;
    tenantEmail = renters[0].email;
    tenantEmailConsent = renters[0].email;
  }

  const tenantRosterLabel = renters.length ? formatRentersRosterLabel(renters) : tenantName;
  const providerName = str(data.provider_name, "Rental Provider");
  const providerEmail = str(data.provider_email, "info@sharehousemanagers.com.au");
  const bondRaw = str(data.bond_amount);
  const bondAmount = bondRaw ? bondRaw.replace(/^\$/, "") : "______________________";
  const commencement = formatDateAu(data.commencement_date) || "________________";
  const terminateDate = formatDateAu(data.terminate_date) || "________________";
  const bondPaymentDue = formatDateAu(data.bond_payment_due) || "________________";
  const signedAt = formatSignedDateTime(extras?.signedAt);
  const docId = str(extras?.documentId);

  function parseItemList(rawItems: unknown): { items: unknown[]; provided: boolean } {
    if (Array.isArray(rawItems)) return { items: rawItems, provided: true };
    if (typeof rawItems === "string" && rawItems.trim()) {
      try {
        const parsed = JSON.parse(rawItems) as unknown;
        if (Array.isArray(parsed)) return { items: parsed, provided: true };
      } catch {
        // ignore
      }
    }
    return { items: [], provided: false };
  }

  function isSelected(row: { selected?: unknown }) {
    return row.selected !== false && row.selected !== "false" && row.selected !== 0;
  }

  /** Strip a leading clause number like "33." / "33A." so selected items can be renumbered without gaps. */
  function stripLeadingClauseNumber(text: string) {
    return str(text).replace(/^\d+[A-Za-z]?\.?\s+/, "").trim();
  }

  function leadingClauseNumber(text: string): number | null {
    const match = str(text).match(/^(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function selectedTermsText(
    rawText: unknown,
    rawItems: unknown,
    options?: { numbered?: boolean },
  ) {
    const { items, provided } = parseItemList(rawItems);

    const fromItems = items
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const row = item as { title?: unknown; body?: unknown; text?: unknown; selected?: unknown };
          if (!isSelected(row)) return "";
          const title = str(row.title);
          const body = str(row.body || row.text);
          if (title && body) return `${title}\n${body}`;
          return title || body;
        }
        return "";
      })
      .filter(Boolean);

    const numbered = options?.numbered !== false;
    // Arrays from the creator UI are authoritative — never fall back to stale full text.
    if (provided) {
      return fromItems
        .map((text, idx) => {
          if (!numbered) return text;
          // Renumber continuously (1,2,3…) after unselect/delete — strip any old leading number.
          return `${idx + 1}. ${stripLeadingClauseNumber(text)}`;
        })
        .join("\n\n");
    }

    return str(rawText);
  }

  function formatRentIncludes() {
    const order: { key: string; label: string }[] = [
      { key: "gas", label: "gas" },
      { key: "water", label: "water" },
      { key: "electricity", label: "electricity" },
      { key: "internet", label: "internet" },
    ];
    let inc: unknown = data.rent_includes;
    if (typeof inc === "string" && inc.trim()) {
      try {
        inc = JSON.parse(inc) as unknown;
      } catch {
        inc = null;
      }
    }
    const labels = order
      .filter((row) => {
        if (!inc || typeof inc !== "object") return true;
        const v = (inc as Record<string, unknown>)[row.key];
        if (v === false || v === "false") return false;
        if (v === undefined) return true;
        return Boolean(v);
      })
      .map((row) => row.label);
    if (!labels.length) return "no utilities specified";
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  }

  function fillTokens(text: string) {
    return text
      .replaceAll("[[PREMISES_ADDRESS]]", str(data.premises_address) || "________________")
      .replaceAll("[[MONTHLY_RENT]]", str(data.monthly_rent, "_____"))
      .replaceAll("[[WEEKLY_RENT]]", str(data.weekly_rent, "_____"))
      .replaceAll("[[BOND_AMOUNT]]", bondAmount)
      .replaceAll("[[BOND_PAYMENT_DUE]]", bondPaymentDue)
      .replaceAll("[[RENT_INCLUDES]]", formatRentIncludes())
      .replaceAll("[[LEASE_PERIOD]]", str(data.lease_period) || "________________")
      .replaceAll("[[COMMENCEMENT_DATE]]", commencement)
      .replaceAll("[[TERMINATE_DATE]]", terminateDate)
      .replaceAll("[[TENANT_EMAIL]]", tenantEmailConsent || tenantEmail || "________________");
  }

  function selectedCoreSectionsText(rawText: unknown, rawItems: unknown) {
    const { items, provided } = parseItemList(rawItems);

    const fromItems = items
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const row = item as { title?: unknown; body?: unknown; text?: unknown; selected?: unknown };
          if (!isSelected(row)) return "";
          const title = str(row.title);
          const body = str(row.body || row.text);
          if (title && body) return `${title}\n${body}`;
          return title || body;
        }
        return "";
      })
      .filter(Boolean)
      .map((block) => fillTokens(block));

    if (provided) return fromItems.join("\n\n");
    return fillTokens(str(rawText));
  }

  function formatAdditionalTerms(rawText: unknown, rawItems: unknown) {
    const { items, provided } = parseItemList(rawItems);

    const fromItems = items
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const row = item as { title?: unknown; body?: unknown; text?: unknown; selected?: unknown };
          if (!isSelected(row)) return "";
          const title = str(row.title);
          const body = str(row.body || row.text);
          if (title && body) return `${title}\n${body}`;
          const text = body || title;
          const match = text.match(
            /^(\d+[A-Za-z]?\.?\s+.+?)(?=\s+(?:The |Rental |Renter |If |All |With |Please |Without |In accordance|This Agreement|Notice |1\. ))([\s\S]*)$/,
          );
          if (match) return `${match[1].trim()}\n${match[2].trim()}`;
          return text;
        }
        return "";
      })
      .filter(Boolean);

    if (provided) {
      // Renumber selected clauses continuously (no gaps). Start from the first
      // selected clause's original number when present (e.g. 11), otherwise 11.
      let nextNum: number | null = null;
      return fromItems
        .map((block) => {
          const nl = block.indexOf("\n");
          const rawTitle = nl >= 0 ? block.slice(0, nl).trim() : block.trim();
          const body = nl >= 0 ? block.slice(nl + 1).trim() : "";
          const original = leadingClauseNumber(rawTitle);
          if (nextNum === null) nextNum = original ?? 11;
          const titleText = stripLeadingClauseNumber(rawTitle) || rawTitle;
          const titled = `${nextNum}. ${titleText}`;
          nextNum += 1;
          return body ? `${titled}\n${body}` : titled;
        })
        .join("\n\n");
    }
    return str(rawText);
  }

  const additionalTerms = formatAdditionalTerms(data.additional_terms_text, data.additional_terms);
  const additionalRules = selectedTermsText(
    data.additional_share_house_rules,
    data.share_house_rules,
    { numbered: true },
  );
  const coreSections = selectedCoreSectionsText(data.core_sections_text, data.core_sections);

  const auditSentTenant =
    renters.length > 1
      ? renters
          .map((r) => `${agreementDate} - Contract is sent to ${r.name} ${r.email}`)
          .join("\n")
      : `${agreementDate} - Contract is sent to ${tenantRosterLabel || tenantName} ${tenantEmail}`;

  return {
    agreement_date: agreementDate,
    provider_name: providerName,
    provider_email: providerEmail,
    tenant_name: tenantName,
    tenant_email: tenantEmail,
    tenant_email_consent: tenantEmailConsent,
    tenant_name_roster: tenantRosterLabel || tenantName,
    tenant_email_roster:
      renters.length > 1 ? formatRentersEmailsForConsentClause(renters) : tenantEmail,
    premises_address: str(data.premises_address),
    monthly_rent: str(data.monthly_rent, "_____"),
    weekly_rent: str(data.weekly_rent, "_____"),
    bond_amount: bondAmount,
    bond_payment_due: bondPaymentDue,
    commencement_date: commencement,
    terminate_date: terminateDate,
    core_sections: coreSections || "No core sections selected.",
    additional_terms: additionalTerms || "No additional terms selected.",
    additional_share_house_rules: additionalRules || "No additional share house rules selected.",
    signed_datetime: signedAt,
    document_id: docId,
    audit_sent_tenant: auditSentTenant,
    audit_sent_provider: `${agreementDate} - Contract is sent to ${providerName} ${providerEmail}`,
    audit_viewed: `${signedAt} - Viewed and signed by ${tenantRosterLabel || tenantName}`,
    audit_verified: `${signedAt} - Email address verified ${tenantRosterLabel || tenantName} ${tenantEmailConsent || tenantEmail}`,
    audit_signed: `${signedAt} - Signed by ${tenantRosterLabel || tenantName}`,
    audit_finalized: `${signedAt} - Document finalized`,
  };
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

type TenantAgreementOptions = {
  documentId?: string;
  tenantSignature?: string;
  providerSignature?: string;
  signedAt?: Date;
  tenantSignatures?: TenantSignatureRecord[];
  providerName?: string;
  providerEmail?: string;
  multiTenant?: boolean;
  signers?: Parameters<typeof resolveRentersForExport>[1];
};

function useMultiTenantAppendix(options?: TenantAgreementOptions) {
  if (options?.multiTenant && (options?.tenantSignatures?.length || 0) > 0) return true;
  return (options?.tenantSignatures?.length || 0) > 1;
}

async function applyMultiTenantAppendix(
  base: { buffer: Buffer; mimeType: string },
  data: Record<string, unknown>,
  options?: TenantAgreementOptions,
) {
  const tenants = options?.tenantSignatures || [];
  if (!useMultiTenantAppendix(options) || tenants.length === 0) {
    return base;
  }
  return finalizeMultiTenantDocument({
    baseBuffer: base.buffer,
    baseMime: base.mimeType,
    providerName: options?.providerName || String(data.provider_name || ""),
    providerEmail: options?.providerEmail || String(data.provider_email || ""),
    providerSignature: options?.providerSignature,
    tenantSignatures: tenants,
  });
}

async function brandedImportedPdfBuffer(data: Record<string, unknown>) {
  const pdf = getImportedPdfBuffer(data);
  if (!pdf) return null;
  return applyShmBrandingToImportedPdfBuffer(pdf, {
    renters: rentersFromAgreementData(data),
    landlord: landlordFromAgreementData(data),
  });
}

async function generateTenantAgreementDocxBuffer(
  data: Record<string, unknown>,
  options?: TenantAgreementOptions,
) {
  const exportData = agreementDataForNativeTenantExport(data);
  if (isImportedTenantAgreementTemplate(exportData)) {
    const imported = getImportedDocxBuffer(exportData);
    if (imported) return imported;
  }
  return generateTenantAgreementDocx(exportData, {
    tenantSignature: options?.tenantSignature,
    providerSignature: options?.providerSignature,
    documentId: options?.documentId,
    signedAt: options?.signedAt,
    signers: options?.signers,
  });
}

export async function generateTenantAgreementPdf(
  data: Record<string, unknown>,
  options?: TenantAgreementOptions,
) {
  const exportData = agreementDataForNativeTenantExport(data);
  if (isImportedTenantAgreementTemplate(exportData)) {
    const pdf = await brandedImportedPdfBuffer(exportData);
    if (pdf) {
      const base = { buffer: pdf, mimeType: PDF_MIME };
      const merged = await applyMultiTenantAppendix(base, exportData, options);
      return { buffer: merged.buffer, mimeType: merged.mimeType };
    }
  }
  const docxBuffer = await generateTenantAgreementDocxBuffer(exportData, options);
  const base = { buffer: docxBuffer, mimeType: DOCX_MIME };
  const merged = await applyMultiTenantAppendix(base, exportData, options);
  return { buffer: merged.buffer, mimeType: merged.mimeType, docxBuffer: merged.isDocx ? merged.buffer : docxBuffer };
}

export async function generateTenantAgreementDocxBase64(
  data: Record<string, unknown>,
  options?: TenantAgreementOptions,
) {
  const exportData = agreementDataForNativeTenantExport(data);
  if (isImportedTenantAgreementTemplate(exportData)) {
    const pdf = await brandedImportedPdfBuffer(exportData);
    if (pdf) {
      const merged = await applyMultiTenantAppendix({ buffer: pdf, mimeType: PDF_MIME }, exportData, options);
      const isPdf = merged.mimeType === PDF_MIME;
      return {
        base64: merged.buffer.toString("base64"),
        mimeType: merged.mimeType,
        isDocx: !isPdf,
        isPdf,
      };
    }
  }
  const docxBuffer = await generateTenantAgreementDocxBuffer(exportData, options);
  const merged = await applyMultiTenantAppendix({ buffer: docxBuffer, mimeType: DOCX_MIME }, exportData, options);
  const isPdf = merged.mimeType === PDF_MIME;
  return {
    base64: merged.buffer.toString("base64"),
    mimeType: merged.mimeType,
    isDocx: !isPdf,
    isPdf,
  };
}

export async function generateTenantAgreementPdfBase64(
  data: Record<string, unknown>,
  options?: TenantAgreementOptions,
) {
  const generated = await generateTenantAgreementPdf(data, options);
  const isPdf = generated.mimeType === PDF_MIME;
  return {
    base64: generated.buffer.toString("base64"),
    mimeType: generated.mimeType,
    isPdf,
    isDocx: !isPdf,
  };
}
