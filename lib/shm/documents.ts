import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import { isRevokedToken } from "./signing-access";

export const SHM_DOCUMENT_TYPES = [
  "Tenant Application",
  "Property Management Agreement",
  "Tenant Agreement",
  "Ownership Statement",
  "PM Takeover Form",
  "Rental Reference Form",
  "Landlord Weekly Report",
] as const;

function normType(documentType: string) {
  return String(documentType || "").trim().toLowerCase();
}

export function isAdminFirstDocumentType(documentType: string) {
  const type = normType(documentType);
  return type === "tenant agreement" || type === "ownership statement";
}

/** Creator opens the form to edit before any signing email is sent (PMA terms/fees, TA clauses, etc.). */
export function isCreatorPrepareBeforeRecipientEmail(documentType: string) {
  return (
    isAdminFirstDocumentType(documentType)
    || isPropertyManagementAgreement(documentType)
    || isLandlordWeeklyReport(documentType)
  );
}

export function isOwnershipStatement(documentType: string) {
  return normType(documentType) === "ownership statement";
}

export function isTenantApplication(documentType: string) {
  return normType(documentType) === "tenant application";
}

export function isTenantAgreement(documentType: string) {
  return normType(documentType) === "tenant agreement";
}

export function isPropertyManagementAgreement(documentType: string) {
  return normType(documentType) === "property management agreement";
}

export function isPmTakeoverForm(documentType: string) {
  return normType(documentType) === "pm takeover form";
}

export function isRentalReferenceForm(documentType: string) {
  return normType(documentType) === "rental reference form";
}

export function isLandlordWeeklyReport(documentType: string) {
  return normType(documentType) === "landlord weekly report";
}

export function isAdminOnlySignedDocumentType(documentType: string) {
  return isLandlordWeeklyReport(documentType);
}

export function isOnePartySignedDocumentType(documentType: string) {
  const type = normType(documentType);
  return type === "pm takeover form" || type === "rental reference form";
}

export function isSignerSelfServiceForm(documentType: string) {
  return isPmTakeoverForm(documentType) || isRentalReferenceForm(documentType);
}

export function templateFileForDocumentType(documentType: string) {
  const type = normType(documentType);
  const templates: Record<string, string> = {
    "tenant application": "tenant-application.html",
    "property management agreement": "property-management-agreement.html",
    "tenant agreement": "tenant-agreement.html",
    "ownership statement": "ownership-statement.html",
    "pm takeover form": "pm-takeover-form.html",
    "rental reference form": "rental-reference-form.html",
    "landlord weekly report": "landlord-weekly-report.html",
  };
  return templates[type] ?? "tenant-application.html";
}

export async function nextShmDocumentId() {
  const last = await prisma.shmDocument.findFirst({ orderBy: { createdAt: "desc" } });
  const currentNumber = last?.documentId ? Number(last.documentId.replace("SHM-", "")) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `SHM-${String(nextNumber).padStart(4, "0")}`;
}

export function createToken() {
  return randomBytes(32).toString("hex");
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
}

export function getSignUrl(documentId: string, token: string, role?: string) {
  const url = new URL("/sign-document", getAppUrl());
  url.searchParams.set("doc_id", documentId);
  url.searchParams.set("token", token);
  if (role) url.searchParams.set("role", role);
  return url.toString();
}

export function signerRoleForToken(document: { token: string; adminToken: string | null; tenantToken: string | null }, token: string) {
  if (document.adminToken && document.adminToken === token) return "creator";
  if (document.tenantToken && document.tenantToken === token) return "recipient";
  return "recipient";
}

export async function logShmEvent(documentId: string, eventType: string, request?: Request) {
  const headers = request?.headers;
  await prisma.shmDocumentEvent.create({
    data: {
      documentId,
      eventType,
      ipAddress: headers?.get("x-forwarded-for")?.split(",")[0] || null,
      userAgent: headers?.get("user-agent") || null,
    },
  });
}

export async function validateShmToken(documentId: string, token: string) {
  if (!documentId || !token || isRevokedToken(token)) return null;
  return prisma.shmDocument.findFirst({
    where: {
      documentId,
      OR: [{ token }, { adminToken: token }, { tenantToken: token }, { signers: { some: { token } } }],
    },
    include: { signers: true },
  });
}

/** Lightweight token check used by public form endpoints. */
export async function validateShmTokenLite(documentId: string, token: string) {
  return validateShmToken(documentId, token);
}

export async function validateShmSignerToken(documentId: string, token: string) {
  if (!documentId || !token || isRevokedToken(token)) return null;
  const signer = await prisma.shmDocumentSigner.findFirst({
    where: { documentId, token },
    include: { document: { include: { signers: true } } },
  });
  if (signer) return { signer, document: signer.document };
  const document = await validateShmToken(documentId, token);
  if (!document) return null;
  const fallbackType = signerRoleForToken(document, token);
  const signerFallback = document.signers.find((item) => item.token === token) || null;
  return { signer: signerFallback, document, signerType: fallbackType };
}

export function tenantAgreementAllRecipientsSigned(
  signers: Array<{ signerType: string; status: string }>,
) {
  const recipients = signers.filter((signer) => signer.signerType === "recipient" && signer.status !== "Removed");
  return recipients.length > 0 && recipients.every((signer) => signer.status === "Signed");
}

export function rollupDocumentStatus(
  signers: Array<{ signerType: string; status: string }>,
  currentStatus?: string,
  documentType?: string,
) {
  if (currentStatus === "Signed" || currentStatus === "Make Error" || currentStatus === "Processing") return currentStatus;
  const creator = signers.find((signer) => signer.signerType === "creator");
  const recipients = signers.filter((signer) => signer.signerType === "recipient" && signer.status !== "Removed");
  const creatorSigned = creator?.status === "Signed";
  const recipientSigned = recipients.length > 0 && recipients.every((signer) => signer.status === "Signed");
  const anyRecipientSigned = recipients.some((signer) => signer.status === "Signed");
  const oneParty = documentType ? isOnePartySignedDocumentType(documentType) : false;
  if (oneParty && recipientSigned) return "Processing";
  if (documentType && isTenantAgreement(documentType)) {
    if (recipientSigned) return "Processing";
    if (anyRecipientSigned) return "Awaiting Signatures";
    if (currentStatus === "Awaiting Signatures" || currentStatus === "Awaiting Tenant") return currentStatus;
  }
  if (creatorSigned && recipientSigned) return "Processing";
  if (recipientSigned && !creatorSigned) return "Awaiting Creator Signature";
  if (creatorSigned && !recipientSigned) return "Awaiting Recipient Signature";
  if (anyRecipientSigned && !recipientSigned) return "Awaiting Recipient Signature";
  if (signers.some((signer) => signer.status === "Viewed" || signer.status === "Opened")) return "Viewed";
  return "Sent";
}
