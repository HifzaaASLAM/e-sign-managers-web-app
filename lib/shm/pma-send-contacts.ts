export type PmaSendContactKind = "signer" | "cc";

export type PmaSendContact = {
  name: string;
  email: string;
  role: string;
  kind: PmaSendContactKind;
};

const MAX_CONTACTS = 5;

function cleanEmail(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKind(value: unknown, row?: Record<string, unknown>): PmaSendContactKind {
  const raw =
    value
    ?? row?.kind
    ?? row?.delivery
    ?? row?.contact_kind;
  return String(raw || "").trim().toLowerCase() === "cc" ? "cc" : "signer";
}

export function parsePmaSendContacts(
  raw: unknown,
  fallback?: { name?: string; email?: string; role?: string },
): PmaSendContact[] {
  const list: PmaSendContact[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const name = cleanText(item.name);
      const email = cleanEmail(item.email);
      if (!name || !email.includes("@")) continue;
      list.push({
        name,
        email,
        role: cleanText(item.role) || "Owner",
        kind: normalizeKind(item.kind, item),
      });
    }
  }
  if (list.length) return list.slice(0, MAX_CONTACTS);

  const name = cleanText(fallback?.name);
  const email = cleanEmail(fallback?.email);
  if (name && email.includes("@")) {
    return [
      {
        name,
        email,
        role: cleanText(fallback?.role) || "Owner",
        kind: "signer",
      },
    ];
  }
  return [];
}

export function splitPmaSendContacts(contacts: PmaSendContact[]) {
  const signers = contacts.filter((c) => c.kind === "signer");
  const ccContacts = contacts.filter((c) => c.kind === "cc");
  const ccEmails = [...new Set(ccContacts.map((c) => c.email))];
  return {
    signers,
    ccContacts,
    ccEmails,
    primary: signers[0] || null,
    additionalSigners: signers.slice(1),
  };
}
