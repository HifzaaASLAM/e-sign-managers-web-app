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
