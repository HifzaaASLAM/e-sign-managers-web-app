import { createToken, getAppUrl } from "./documents";

export type LandlordRecord = {
  name: string;
  email: string;
  token: string;
  status: "pending" | "invited" | "approved";
  invitedAt?: string;
  approvedAt?: string;
  reviewUrl?: string;
};

export function parseLandlordInput(nameRaw: unknown, emailRaw: unknown): { name: string; email: string } | null {
  const name = String(nameRaw || "").trim();
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!name && !email) return null;
  if (!name || !email || !email.includes("@")) {
    throw new Error("Landlord name and a valid email are required when adding a landlord.");
  }
  return { name, email };
}

export function buildLandlordRecord(name: string, email: string): LandlordRecord {
  const token = createToken();
  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    token,
    status: "pending",
  };
}

export function getLandlordReviewUrl(documentId: string, token: string) {
  const url = new URL("/landlord-approve", getAppUrl());
  url.searchParams.set("doc_id", documentId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function readLandlordFromAgreement(agreementData: Record<string, unknown> | null | undefined): LandlordRecord | null {
  const landlord = agreementData?.landlord;
  if (!landlord || typeof landlord !== "object") return null;
  const record = landlord as Partial<LandlordRecord>;
  if (!record.email || !record.token) return null;
  return {
    name: String(record.name || "Landlord"),
    email: String(record.email).toLowerCase(),
    token: String(record.token),
    status: (record.status as LandlordRecord["status"]) || "pending",
    invitedAt: record.invitedAt,
    approvedAt: record.approvedAt,
    reviewUrl: record.reviewUrl,
  };
}

export function tenantSummaryFromFields(fieldValues: Record<string, unknown>, fallback?: {
  name?: string;
  email?: string;
  propertyAddress?: string;
}) {
  const first = String(fieldValues.e_first || "").trim();
  const last = String(fieldValues.e_last || "").trim();
  const name = [first, last].filter(Boolean).join(" ") || fallback?.name || "Applicant";
  return {
    name,
    firstName: first || name.split(/\s+/)[0] || "",
    lastName: last || name.split(/\s+/).slice(1).join(" ") || "",
    email: String(fieldValues.e_email || fallback?.email || "").trim().toLowerCase(),
    phone: String(fieldValues.e_phbh || fieldValues.e_phah || "").trim(),
    dateOfBirth: String(fieldValues.e_dob || "").trim(),
    currentAddress: [fieldValues.e_addr, fieldValues.e_addr2, fieldValues.e_pc]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(", "),
    occupation: String(fieldValues.e_occ || "").trim(),
    employer: String(fieldValues.e_emp || "").trim(),
    salary: String(fieldValues.e_sal || "").trim(),
    propertyAddress: String(fieldValues.d_addr || fallback?.propertyAddress || "").trim(),
    rent: String(fieldValues.d_rent || "").trim(),
    rentPeriod: String(fieldValues.d_rper || "").trim(),
    bond: String(fieldValues.d_bond || "").trim(),
    tenancyStart: String(fieldValues.d_start || "").trim(),
    tenancyEnd: String(fieldValues.d_end || "").trim(),
    reference1: {
      name: String(fieldValues.r1n || "").trim(),
      relationship: String(fieldValues.r1rel || "").trim(),
      phone: String(fieldValues.r1hph || fieldValues.r1wph || "").trim(),
    },
    reference2: {
      name: String(fieldValues.r2n || "").trim(),
      relationship: String(fieldValues.r2rel || "").trim(),
      phone: String(fieldValues.r2hph || fieldValues.r2wph || "").trim(),
    },
  };
}
