import type { TemplateRecipient } from "./create-from-template";

export function parseTenantRecipientsJson(raw: unknown): TemplateRecipient[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          tenant_name: String(item.tenant_name || item.name || "").trim(),
          tenant_email: String(item.tenant_email || item.email || "")
            .trim()
            .toLowerCase(),
          premises_address: String(item.premises_address || item.address || "").trim() || undefined,
        };
      })
      .filter((row) => {
        if (!row.tenant_name || !row.tenant_email.includes("@")) return false;
        if (seen.has(row.tenant_email)) return false;
        seen.add(row.tenant_email);
        return true;
      });
  } catch {
    return [];
  }
}
