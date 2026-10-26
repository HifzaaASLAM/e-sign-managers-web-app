import { prisma } from "../prisma";
import { isTenantAgreement, logShmEvent, tenantAgreementAllRecipientsSigned } from "./documents";
import {
  sendTenantAgreementFinalInfoEmail,
  sendTenantAgreementFinalPartyEmail,
} from "./mailer";
import { rentalProviderFromAgreementData } from "./multi-tenant-signatures";

function parseAgreementData(raw: string | null | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mergeAgreementData(existingRaw: string | null, patch: Record<string, unknown>) {
  return JSON.stringify({ ...parseAgreementData(existingRaw), ...patch });
}

function readSentPartyEmails(agreementData: Record<string, unknown>) {
  const raw = agreementData.ta_final_party_emails_sent;
  if (!Array.isArray(raw)) return new Set<string>();
  return new Set(raw.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

async function buildTenantAgreementFinalAttachment(documentId: string) {
  try {
    const { buildTenantAgreementDashboardPreview } = await import("./tenant-agreement-dashboard-preview");
    const generated = await buildTenantAgreementDashboardPreview(documentId, "docx");
    if (!generated?.buffer.length) return [];
    return [
      {
        fileName: generated.fileName.replace(/-preview\./, "-signed."),
        fileContent: generated.buffer.toString("base64"),
        fileType: generated.fileType,
      },
    ];
  } catch (error) {
    console.error("[ta-final-delivery-emails] docx attachment failed", error);
    return [];
  }
}

type TaParty = { email: string; name: string; role: "tenant" | "landlord" };

function collectTenantAgreementFinalParties(
  doc: {
    recipientName: string | null;
    recipientEmail: string | null;
    signers: Array<{ signerType: string; status: string; name: string; email: string; role: string }>;
  },
  agreementData: Record<string, unknown>,
): TaParty[] {
  const parties: TaParty[] = [];
  const seen = new Set<string>();
  const provider = rentalProviderFromAgreementData(agreementData);
  const providerEmail = provider?.email || "";

  const add = (email: string, name: string, role: "tenant" | "landlord") => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@") || seen.has(normalized)) return;
    seen.add(normalized);
    parties.push({ email: normalized, name: name.trim() || (role === "landlord" ? "Landlord" : "Tenant"), role });
  };

  for (const signer of doc.signers) {
    if (signer.signerType !== "recipient" || signer.status !== "Signed") continue;
    const email = String(signer.email || "").trim().toLowerCase();
    const isLandlord =
      /rental provider|landlord/i.test(String(signer.role || ""))
      || (providerEmail && email === providerEmail);
    add(email, signer.name, isLandlord ? "landlord" : "tenant");
  }

  const primaryTenantEmail = String(doc.recipientEmail || "").trim().toLowerCase();
  if (primaryTenantEmail) {
    add(primaryTenantEmail, doc.recipientName || "Tenant", "tenant");
  }

  if (provider) {
    add(provider.email, provider.name, "landlord");
  }

  return parties;
}

/** After tenant + landlord signed and Drive upload confirmed — email both parties + info@. */
export async function deliverTenantAgreementFinalSignedEmailsIfNeeded(
  documentId: string,
  fileUrl: string | null | undefined,
  request?: Request,
  options?: { force?: boolean },
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isTenantAgreement(doc.documentType)) return;

  if (!tenantAgreementAllRecipientsSigned(doc.signers)) return;

  const agreementData = parseAgreementData(doc.agreementData);
  const sentParties = readSentPartyEmails(agreementData);
  const infoAlreadySent = Boolean(agreementData.ta_final_info_email_sent_at);
  const legacyComplete = Boolean(agreementData.ta_final_delivery_emails_sent_at);
  const parties = collectTenantAgreementFinalParties(doc, agreementData);
  const pendingParties = options?.force
    ? parties
    : parties.filter((party) => !sentParties.has(party.email));
  if (!pendingParties.length && (infoAlreadySent || legacyComplete) && !options?.force) return;

  const attachments = await buildTenantAgreementFinalAttachment(documentId);
  const driveUrl = String(fileUrl || doc.signedDriveUrl || "").trim() || null;
  const provider = rentalProviderFromAgreementData(agreementData);
  const tenantParty = parties.find((party) => party.role === "tenant") || parties[0];

  const base = {
    documentId: doc.documentId,
    documentType: doc.documentType,
    propertyAddress: doc.propertyAddress,
    tenantName: tenantParty?.name || doc.recipientName,
    tenantEmail: tenantParty?.email || doc.recipientEmail,
    landlordName: provider?.name || parties.find((party) => party.role === "landlord")?.name || null,
    landlordEmail: provider?.email || parties.find((party) => party.role === "landlord")?.email || null,
    fileUrl: driveUrl,
    attachments,
  };

  const nextSent = new Set(sentParties);
  for (const party of pendingParties) {
    const result = await sendTenantAgreementFinalPartyEmail({
      ...base,
      to: party.email,
      name: party.name,
      partyRole: party.role,
    });
    await logShmEvent(
      documentId,
      result.ok
        ? `ta_final_${party.role}_email_sent`
        : result.skipped
          ? `ta_final_${party.role}_email_skipped`
          : `ta_final_${party.role}_email_error`,
      request,
    );
    if (result.ok) nextSent.add(party.email);
  }

  let infoOk = infoAlreadySent;
  if (!infoAlreadySent || options?.force) {
    const infoResult = await sendTenantAgreementFinalInfoEmail(base);
    infoOk = infoResult.ok || infoAlreadySent;
    await logShmEvent(
      documentId,
      infoResult.ok
        ? "ta_final_info_email_sent"
        : infoResult.skipped
          ? "ta_final_info_email_skipped"
          : "ta_final_info_email_error",
      request,
    );
  }

  const patch: Record<string, unknown> = {
    ta_final_party_emails_sent: [...nextSent],
  };
  if (infoOk) {
    patch.ta_final_info_email_sent_at =
      agreementData.ta_final_info_email_sent_at || new Date().toISOString();
  }
  if (nextSent.size >= parties.length && infoOk) {
    patch.ta_final_delivery_emails_sent_at = new Date().toISOString();
  }
  await prisma.shmDocument.update({
    where: { documentId },
    data: { agreementData: mergeAgreementData(doc.agreementData, patch) },
  });
}

export async function attemptTenantAgreementEmailRecoveryOnUploadFailure(
  documentId: string,
  request?: Request,
  options?: { forceEmail?: boolean },
) {
  const doc = await prisma.shmDocument.findUnique({
    where: { documentId },
    include: { signers: true },
  });
  if (!doc || !isTenantAgreement(doc.documentType)) return { ok: false as const, reason: "not_ta" };
  if (!tenantAgreementAllRecipientsSigned(doc.signers)) {
    return { ok: false as const, reason: "not_fully_signed" };
  }

  await deliverTenantAgreementFinalSignedEmailsIfNeeded(documentId, doc.signedDriveUrl, request, {
    force: options?.forceEmail,
  });

  const refreshed = await prisma.shmDocument.findUnique({
    where: { documentId },
    select: { agreementData: true },
  });
  const data = parseAgreementData(refreshed?.agreementData);
  if (data.ta_final_info_email_sent_at || data.ta_final_delivery_emails_sent_at) {
    await prisma.shmDocument.update({
      where: { documentId },
      data: { status: "Signed" },
    });
    await logShmEvent(documentId, "ta_final_recovery_signed_status", request);
    return { ok: true as const, emailsSent: true };
  }

  return { ok: false as const, reason: "emails_not_sent" };
}
