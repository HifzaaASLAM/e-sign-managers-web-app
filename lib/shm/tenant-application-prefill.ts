/** Part E (and related) — never prefill from applicant profile or saved profileData. */
export const TENANT_APPLICATION_APPLICANT_FIELD_IDS = [
  "e_first",
  "e_last",
  "e_addr",
  "e_addr2",
  "e_pc",
  "e_phbh",
  "e_phah",
  "e_email",
  "e_dob",
  "e_depn",
  "e_depa",
  "e_prp",
  "e_prpph",
  "e_prpeml",
  "e_occ",
  "e_sal",
  "e_othinc",
  "e_emp",
  "e_empaddr",
  "e_empaddr2",
  "e_emppc",
  "e_empyrs",
  "e_empmos",
  "e_emppos",
  "e_empcnt",
  "e_empph",
  "e_pemp",
  "e_pempyrs",
  "e_pempmos",
  "e_pemppos",
  "e_pempcnt",
  "e_pempph",
  "r1n",
  "r1rel",
  "r1hph",
  "r1wph",
  "r2n",
  "r2rel",
  "r2hph",
  "r2wph",
  "pdet",
] as const;

export function omitTenantApplicationApplicantPrefill(fields: Record<string, unknown>) {
  const out = { ...fields };
  for (const key of TENANT_APPLICATION_APPLICANT_FIELD_IDS) {
    delete out[key];
  }
  return out;
}

/** Normalize optional admin-entered rent for tenant application prefill. */
export function parseRentAmount(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return String(amount);
}

export function formatRentDisplay(raw: unknown): string {
  const parsed = parseRentAmount(raw);
  if (!parsed) return "Not provided";
  const amount = Number(parsed);
  if (!Number.isFinite(amount)) return "Not provided";
  const formatted = Number.isInteger(amount)
    ? amount.toLocaleString("en-AU")
    : amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${formatted}`;
}

export function buildTenantApplicationAgreementData(input: {
  propertyAddress?: string;
  rentAmount?: unknown;
  extraFields?: Record<string, unknown>;
  landlord?: { name: string; email: string; token: string; status?: string } | null;
}): string | null {
  const rent = parseRentAmount(input.rentAmount);
  const address = String(input.propertyAddress || "").trim();
  const extra = input.extraFields || {};
  const landlord = input.landlord || null;

  if (!rent && !address && !Object.keys(extra).length && !landlord) return null;

  const fieldValues: Record<string, unknown> = { ...extra };
  if (address) fieldValues.d_addr = address;
  if (rent) fieldValues.d_rent = rent;

  return JSON.stringify({
    field_values: fieldValues,
    ...(landlord
      ? {
          landlord: {
            name: landlord.name,
            email: landlord.email,
            token: landlord.token,
            status: landlord.status || "pending",
          },
        }
      : {}),
  });
}
