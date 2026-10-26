export type TaTemplateAgreementData = Record<string, unknown>;

export function parseTemplateAgreementData(raw: string | null | undefined): TaTemplateAgreementData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TaTemplateAgreementData) : {};
  } catch {
    return {};
  }
}

/** Fields that should stay blank when reusing a template for a new tenant. */
const SIGNER_SPECIFIC_KEYS = new Set([
  "tenant_name",
  "tenant_email",
  "tenant_name_field",
  "tenant_email_field",
  "recipientName",
  "recipientEmail",
  "provider_name",
  "provider_email",
  "landlord_name",
  "landlord_email",
]);

function normalizeLandlordNameForCompare(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function agentDisplayNameForCompare(adminName: string) {
  const n = String(adminName || "").trim();
  if (!n || /^sharehouse\s*managers?$/i.test(n) || n.toLowerCase() === "sharehousemanagers") {
    return "ishaq m";
  }
  return normalizeLandlordNameForCompare(n);
}

/** Drop workspace admin / SHM defaults mistaken for rental provider (creator fills landlord manually). */
export function sanitizeTenantAgreementLandlordFields(
  data: TaTemplateAgreementData,
  opts?: { adminName?: string | null; adminEmail?: string | null },
): TaTemplateAgreementData {
  const adminName = String(opts?.adminName || "").trim();
  const adminEmail = String(opts?.adminEmail || "").trim().toLowerCase();
  const adminDisp = agentDisplayNameForCompare(adminName);

  function cleanName(raw: unknown): string {
    let name = String(raw ?? "").trim();
    if (!name) return "";
    const cmp = normalizeLandlordNameForCompare(name);
    if (/^sharehouse\s*managers?$/i.test(name)) return "";
    if (adminName && (cmp === normalizeLandlordNameForCompare(adminName) || cmp === adminDisp)) return "";
    return name;
  }

  function cleanEmail(raw: unknown): string {
    const email = String(raw ?? "").trim().toLowerCase();
    if (!email) return "";
    if (email === adminEmail || email === "info@sharehousemanagers.com.au") return "";
    return email;
  }

  const out = { ...data };
  if ("provider_name" in out) out.provider_name = cleanName(out.provider_name);
  if ("provider_email" in out) out.provider_email = cleanEmail(out.provider_email);
  if ("landlord_name" in out) out.landlord_name = cleanName(out.landlord_name);
  if ("landlord_email" in out) out.landlord_email = cleanEmail(out.landlord_email);

  for (const key of ["field_values", "fieldValues"] as const) {
    const nested = out[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const fv = { ...(nested as Record<string, unknown>) };
    if ("provider_name" in fv) fv.provider_name = cleanName(fv.provider_name);
    if ("provider_email" in fv) fv.provider_email = cleanEmail(fv.provider_email);
    out[key] = fv;
  }

  return out;
}

export function cloneTemplateDataForNewAgreement(
  raw: string | null | undefined,
  overrides?: { tenant_name?: string; tenant_email?: string; premises_address?: string },
): TaTemplateAgreementData {
  const data = { ...parseTemplateAgreementData(raw) };
  for (const key of SIGNER_SPECIFIC_KEYS) delete data[key];
  if (overrides?.tenant_name) data.tenant_name = overrides.tenant_name;
  if (overrides?.tenant_email) data.tenant_email = overrides.tenant_email;
  if (overrides?.premises_address != null && String(overrides.premises_address).trim()) {
    data.premises_address = overrides.premises_address;
  }
  return data;
}

export function sanitizeTemplatePayload(input: unknown): TaTemplateAgreementData {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return { ...(input as TaTemplateAgreementData) };
}
