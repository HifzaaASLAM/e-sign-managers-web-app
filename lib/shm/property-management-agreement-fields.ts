/** Canonical PMA field ids used in agreementData and DOCX generation. */
export const PMA_CANONICAL_TO_FORM: Record<string, string> = {
  available_from: "pma_available_from",
  available_to: "pma_available_to",
  property: "pma_property",
  block: "pma_block",
  section: "pma_section",
  division: "pma_division",
  eer: "pma_eer",
  property_type: "pma_property_type",
  description: "pma_description",
  heating: "pma_heating",
  hot_water: "pma_hot_water",
  dishwasher: "pma_dishwasher",
  oven: "pma_oven",
  cooktop: "pma_cooktop",
  warranties: "pma_warranties",
  rent_pw: "pma_rent_pw",
  commencement: "pma_commencement",
  lease_term: "pma_lease_term",
  keys: "pma_keys",
  owner: "pma_owner",
  postal_address: "pma_postal_address",
  phone_ah: "pma_phone_ah",
  phone_bh: "pma_phone_bh",
  mobile: "pma_mobile",
  email: "pma_email",
  unit_plan_no: "pma_unit_plan_no",
  unit_plan_manager: "pma_unit_plan_manager",
  unit_phone: "pma_unit_phone",
  fax: "pma_fax",
  deposit_to: "pma_deposit_to",
  bank: "pma_bank",
  branch: "pma_branch",
  bsb: "pma_bsb",
  account: "pma_account",
  repairs: "pma_repairs",
  preferred_contact: "pma_preferred_contact",
  intend_sell: "pma_intend_sell",
  building_insurer: "pma_building_insurer",
  building_policy: "pma_building_policy",
  building_renewal: "pma_building_renewal",
  contents_insurer: "pma_contents_insurer",
  contents_policy: "pma_contents_policy",
  contents_renewal: "pma_contents_renewal",
  landlord_insurer: "pma_landlord_insurer",
  landlord_policy: "pma_landlord_policy",
  landlord_renewal: "pma_landlord_renewal",
  emergency_contact: "pma_emergency_contact",
  emergency_phone: "pma_emergency_phone",
  other_instructions: "pma_other_instructions",
  special_instructions: "pma_special_instructions",
  instruction_books: "pma_instruction_books",
  hot_water_location: "pma_hot_water_location",
  meter_box: "pma_meter_box",
  water_meter: "pma_water_meter",
  additional_info: "pma_additional_info",
  owner_sign_name: "pma_owner_sign_name",
  sig_date: "pma_sigdt",
  agent_sign_name: "pma_agent_sign_name",
  agent_sig_date: "pma_agent_sigdt",
  term_appointment: "pma_term_appointment",
  term_management_fees: "pma_term_management_fees",
  term_termination: "pma_term_termination",
  term_keys: "pma_term_keys",
  term_insurance: "pma_term_insurance",
  term_duties: "pma_term_duties",
  term_expenditure: "pma_term_expenditure",
  term_privacy: "pma_term_privacy",
  fee_initial_letting: "pma_fee_initial_letting",
  fee_advertising: "pma_fee_advertising",
  fee_quick_rent_sign: "pma_fee_quick_rent_sign",
  fee_attendance: "pma_fee_attendance",
  fee_renegotiation: "pma_fee_renegotiation",
  fee_management: "pma_fee_management",
  fee_monthly_statement: "pma_fee_monthly_statement",
  fee_tribunal: "pma_fee_tribunal",
  fee_gst: "pma_fee_gst",
};

/**
 * Agency-authored fields the owner must not override (PropertyMe-style: agent maintains
 * bank details; owner reviews and signs). Includes Part D/E terms/fees and Part C bank.
 */
export const PMA_AGENCY_BANK_CANONICAL_KEYS = [
  "deposit_to",
  "bank",
  "branch",
  "bsb",
  "account",
] as const;

/** Part D/E — only the agency (creator) may edit; owner/recipient sees client values. */
export const PMA_CLIENT_ONLY_CANONICAL_KEYS = [
  ...PMA_AGENCY_BANK_CANONICAL_KEYS,
  "term_appointment",
  "term_management_fees",
  "term_termination",
  "term_keys",
  "term_insurance",
  "term_duties",
  "term_expenditure",
  "term_privacy",
  "fee_initial_letting",
  "fee_advertising",
  "fee_quick_rent_sign",
  "fee_attendance",
  "fee_renegotiation",
  "fee_management",
  "fee_monthly_statement",
  "fee_tribunal",
  "fee_gst",
] as const;

const PMA_META_KEYS = new Set([
  "field_values",
  "fieldValues",
  "last_submission",
  "fileContent",
  "pdfFileContent",
  "docxFileContent",
  "agreement_data",
  "agreementData",
  "signature",
  "agent_signature",
  "pma_sig",
  "pma_agent_sig",
  "submittedAt",
]);

function hasStoredValue(value: unknown) {
  if (value === undefined || value === null) return false;
  return String(value).trim() !== "";
}

/** collectAgreementData() writes canonical keys; stale pma_* copies must not win over canonical. */
function pickPmaFieldPair(
  canonical: string,
  formId: string,
  ...sources: Array<Record<string, unknown>>
) {
  for (const source of sources) {
    const canonicalVal = source[canonical];
    if (hasStoredValue(canonicalVal)) {
      return { canonical: String(canonicalVal).trim(), formId: String(canonicalVal).trim() };
    }
  }
  for (const source of sources) {
    const formVal = source[formId];
    if (hasStoredValue(formVal)) {
      return { canonical: String(formVal).trim(), formId: String(formVal).trim() };
    }
  }
  return null;
}

export function parsePmaAgreementData(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Merge nested field_values with root keys; prefer newest non-empty root values. */
export function pmaMergedFieldValuesForPrefill(data: Record<string, unknown>) {
  const nested =
    data.field_values && typeof data.field_values === "object" && !Array.isArray(data.field_values)
      ? (data.field_values as Record<string, unknown>)
      : data.fieldValues && typeof data.fieldValues === "object" && !Array.isArray(data.fieldValues)
        ? (data.fieldValues as Record<string, unknown>)
        : {};

  const merged: Record<string, unknown> = { ...nested, ...data };
  for (const key of PMA_META_KEYS) {
    delete merged[key];
  }

  for (const [canonical, formId] of Object.entries(PMA_CANONICAL_TO_FORM)) {
    const picked = pickPmaFieldPair(canonical, formId, data, nested);
    if (picked) {
      merged[canonical] = picked.canonical;
      merged[formId] = picked.formId;
    }
  }

  return merged;
}

/** Persist creator edits in both field_values and canonical root keys. */
export function normalizePmaAgreementStorage(input: Record<string, unknown>) {
  const base: Record<string, unknown> = { ...input };
  const fieldValues = pmaMergedFieldValuesForPrefill(base);

  for (const [canonical, formId] of Object.entries(PMA_CANONICAL_TO_FORM)) {
    const picked = pickPmaFieldPair(canonical, formId, fieldValues);
    if (picked) {
      fieldValues[formId] = picked.formId;
      fieldValues[canonical] = picked.canonical;
      base[formId] = picked.formId;
      base[canonical] = picked.canonical;
    }
  }

  for (const [key, value] of Object.entries(fieldValues)) {
    if (key.startsWith("pma_") && hasStoredValue(value)) {
      base[key] = value;
    }
  }

  base.field_values = fieldValues;
  return base;
}

/** When the property owner signs, keep agency-authored terms/fees from stored data. */
export function applyPmaClientOnlyFieldsFromStored(
  stored: Record<string, unknown>,
  merged: Record<string, unknown>,
) {
  const storedFlat = pmaMergedFieldValuesForPrefill(stored);
  const out = { ...merged };
  for (const canonical of PMA_CLIENT_ONLY_CANONICAL_KEYS) {
    const formId = PMA_CANONICAL_TO_FORM[canonical];
    const storedPair = pickPmaFieldPair(canonical, formId, storedFlat);
    const storedVal = storedPair?.canonical;
    if (hasStoredValue(storedVal)) {
      out[canonical] = storedVal;
      out[formId] = storedVal;
    }
  }
  return out;
}

/** Flat merged values with both canonical and pma_* keys for signing UI prefill. */
export function preparePmaAgreementDataForSigningUi(data: Record<string, unknown>) {
  const merged = pmaMergedFieldValuesForPrefill(data);
  const out: Record<string, unknown> = { ...data, ...merged };
  const fieldValues: Record<string, unknown> = { ...merged };

  for (const [canonical, formId] of Object.entries(PMA_CANONICAL_TO_FORM)) {
    const picked = pickPmaFieldPair(canonical, formId, merged);
    if (!picked) continue;
    out[canonical] = picked.canonical;
    out[formId] = picked.formId;
    fieldValues[canonical] = picked.canonical;
    fieldValues[formId] = picked.formId;
  }

  const ownerName =
    pickPmaFieldPair("owner", "pma_owner", out)?.canonical ||
    String(out.recipientName || "").trim();
  const depositPair = pickPmaFieldPair("deposit_to", "pma_deposit_to", out);
  if (ownerName && !depositPair) {
    out.deposit_to = ownerName;
    out.pma_deposit_to = ownerName;
    fieldValues.deposit_to = ownerName;
    fieldValues.pma_deposit_to = ownerName;
  }

  out.field_values = fieldValues;
  return out;
}

export function mergePmaFieldValues(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const storedFieldValues =
    stored.field_values && typeof stored.field_values === "object" && !Array.isArray(stored.field_values)
      ? (stored.field_values as Record<string, unknown>)
      : {};

  const merged: Record<string, unknown> = {
    ...storedFieldValues,
    ...stored,
    ...incoming,
  };

  delete merged.field_values;
  delete merged.fieldValues;
  delete merged.last_submission;
  delete merged.fileContent;
  delete merged.pdfFileContent;
  delete merged.docxFileContent;
  delete merged.agreement_data;
  delete merged.agreementData;
  delete merged.signature;
  delete merged.agent_signature;
  delete merged.pma_sig;
  delete merged.pma_agent_sig;
  delete merged.submittedAt;

  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "string" && value.startsWith("data:") && value.length > 50000) {
      delete merged[key];
    }
  }

  return normalizePmaAgreementStorage(merged);
}
