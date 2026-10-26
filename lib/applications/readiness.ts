/** Required CAV Tenant Application fields used for readiness / Match-style score. */
export const TENANT_APPLICATION_REQUIRED_FIELDS = [
  "e_first",
  "e_last",
  "e_email",
  "e_addr",
  "e_phbh",
  "e_dob",
  "e_occ",
  "e_emp",
  "e_sal",
  "d_addr",
  "r1n",
  "r1rel",
] as const;

export type FieldSnapshot = Record<string, unknown>;

function unwrapFieldValues(raw: FieldSnapshot | null | undefined): FieldSnapshot {
  if (!raw || typeof raw !== "object") return {};
  const nested =
    (raw.field_values as FieldSnapshot | undefined) ||
    (raw.fieldValues as FieldSnapshot | undefined) ||
    (raw.agreement_data as FieldSnapshot | undefined) ||
    (raw.agreementData as FieldSnapshot | undefined);
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...raw, ...nested };
  }
  return raw;
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

export function computeReadinessScore(
  agreementData: FieldSnapshot | string | null | undefined,
  options?: { hasSignature?: boolean },
): number {
  let snapshot: FieldSnapshot = {};
  if (typeof agreementData === "string") {
    try {
      snapshot = JSON.parse(agreementData) as FieldSnapshot;
    } catch {
      snapshot = {};
    }
  } else if (agreementData && typeof agreementData === "object") {
    snapshot = agreementData;
  }

  const fields = unwrapFieldValues(snapshot);
  const required = TENANT_APPLICATION_REQUIRED_FIELDS;
  const filled = required.filter((key) => isFilled(fields[key])).length;

  const hasSignature =
    options?.hasSignature === true ||
    isFilled(fields.e_sig) ||
    isFilled(snapshot.tenant_signature) ||
    isFilled(snapshot.admin_signature);

  const totalSlots = required.length + 1;
  const earned = filled + (hasSignature ? 1 : 0);
  return Math.round((earned / totalSlots) * 100);
}

export function profileDataFromFields(fields: FieldSnapshot): string {
  const clean: FieldSnapshot = {};
  for (const [key, value] of Object.entries(unwrapFieldValues(fields))) {
    if (key.startsWith("e_") || key.startsWith("r") || key.startsWith("et_") || key.startsWith("p")) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        clean[key] = value;
      }
    }
  }
  return JSON.stringify(clean);
}
