export type BulkRecipient = {
  name: string;
  email: string;
  propertyAddress?: string;
  role?: string;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if ((ch === "," || ch === ";") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Parse lines: Name, Email, Property (optional), Role (optional). */
export function parseRecipientLines(raw: string): BulkRecipient[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const recipients: BulkRecipient[] = [];
  for (const line of lines) {
    if (/^name\s*[,;\t]\s*email/i.test(line)) continue;

    const parts = line.includes("\t")
      ? line.split("\t").map((p) => p.trim())
      : splitCsvLine(line);

    const name = String(parts[0] || "").trim();
    const email = String(parts[1] || "").trim().toLowerCase();
    const propertyAddress = String(parts[2] || "").trim() || undefined;
    const role = String(parts[3] || "").trim() || undefined;
    if (!name || !email || !email.includes("@")) continue;
    recipients.push({ name, email, propertyAddress, role });
  }
  return recipients;
}

export const BULK_SEND_MAX_RECIPIENTS = 40;
