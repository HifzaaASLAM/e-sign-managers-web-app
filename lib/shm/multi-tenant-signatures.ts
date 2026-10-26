export type TenantSignatureRecord = {
  signerId: string;
  name: string;
  email: string;
  signature: string;
  signedAt?: string;
};

export function isMultiTenantAgreementData(agreementData: Record<string, unknown>) {
  if (agreementData.multi_tenant_send === true) return true;
  const list = agreementData.multi_tenant_recipients;
  return Array.isArray(list) && list.length > 1;
}

export function rentalProviderFromAgreementData(agreementData: Record<string, unknown>) {
  const raw = agreementData.rental_provider_signer;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const name = String(row.name || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    if (name && email.includes("@")) return { name, email };
  }
  const name = String(agreementData.provider_name || "").trim();
  const email = String(agreementData.provider_email || "").trim().toLowerCase();
  if (!name || !email.includes("@")) return null;
  return { name, email };
}

export function isDualRentalProviderTenantSign(agreementData: Record<string, unknown>) {
  return agreementData.rental_provider_dual_sign === true;
}

export function shouldBuildSharedTenantAgreementFile(
  agreementData: Record<string, unknown>,
  recipientSignerCount: number,
) {
  return isMultiTenantAgreementData(agreementData) || (recipientSignerCount > 1 && isDualRentalProviderTenantSign(agreementData));
}

export function rentalProviderSignatureFromSigners(
  signers: Array<{ signerType: string; role: string; status: string; signature: string | null; email?: string }>,
  agreementData: Record<string, unknown>,
) {
  const provider = rentalProviderFromAgreementData(agreementData);
  const byRole = signers.find(
    (s) =>
      s.signerType === "recipient" &&
      s.status === "Signed" &&
      /rental provider/i.test(String(s.role || "")) &&
      String(s.signature || "").trim(),
  );
  if (byRole?.signature) return String(byRole.signature).trim();
  if (provider) {
    const byEmail = signers.find(
      (s) =>
        s.signerType === "recipient" &&
        s.status === "Signed" &&
        String(s.email || "").toLowerCase() === provider.email &&
        String(s.signature || "").trim(),
    );
    if (byEmail?.signature) return String(byEmail.signature).trim();
  }
  return "";
}

export function tenantSignatureRecordsFromSigners(
  signers: Array<{
    id: string;
    name: string;
    email: string;
    signerType: string;
    status: string;
    signature: string | null;
    signedAt: Date | null;
  }>,
): TenantSignatureRecord[] {
  return signers
    .filter((s) => s.signerType === "recipient" && s.status === "Signed" && String(s.signature || "").trim())
    .map((s) => ({
      signerId: s.id,
      name: s.name,
      email: s.email,
      signature: String(s.signature || "").trim(),
      signedAt: s.signedAt ? s.signedAt.toISOString() : undefined,
    }));
}

export type AgreementRenterRow = { name: string; email: string };

export function landlordFromAgreementData(agreementData: Record<string, unknown>): AgreementRenterRow | null {
  const raw = agreementData.multi_tenant_landlord;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const name = String(row.name || row.landlord_name || row.tenant_name || "").trim();
    const email = String(row.email || row.landlord_email || row.tenant_email || "").trim();
    if (name && email.includes("@")) return { name, email };
  }
  const name = String(agreementData.landlord_name || "").trim();
  const email = String(agreementData.landlord_email || "").trim();
  if (name && email.includes("@")) return { name, email };
  return null;
}

export function rentersFromAgreementData(agreementData: Record<string, unknown>): AgreementRenterRow[] {
  const fromList = agreementData.multi_tenant_recipients;
  if (Array.isArray(fromList) && fromList.length) {
    return fromList
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          name: String(item.tenant_name || item.name || "").trim(),
          email: String(item.tenant_email || item.email || "").trim().toLowerCase(),
        };
      })
      .filter((row) => row.name && row.email.includes("@"));
  }

  const names = String(agreementData.tenant_name || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const emails = String(agreementData.tenant_email || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (names.length > 1) {
    return names.map((name, index) => ({
      name,
      email: emails[index] || emails[0] || "",
    }));
  }
  return [];
}

type ExportSigner = {
  signerType: string;
  role: string;
  name: string;
  email: string;
  status?: string;
};

/** Co-renters for export — agreement list first, then tenant recipient signers on the document. */
export function resolveRentersForExport(
  agreementData: Record<string, unknown>,
  signers?: ExportSigner[],
): AgreementRenterRow[] {
  const fromAgreement = rentersFromAgreementData(agreementData);
  if (fromAgreement.length >= 2) return fromAgreement;

  const fromSigners = (signers || [])
    .filter(
      (s) =>
        s.signerType === "recipient" &&
        s.status !== "Removed" &&
        String(s.role || "").toLowerCase() === "tenant",
    )
    .map((s) => ({
      name: String(s.name || "").trim(),
      email: String(s.email || "").trim().toLowerCase(),
    }))
    .filter((row) => row.name && row.email.includes("@"));

  if (fromSigners.length >= 2) return fromSigners;
  if (fromAgreement.length === 1) return fromAgreement;
  if (fromSigners.length === 1) return fromSigners;
  return [];
}

export function formatRentersNamesForPartiesSection(renters: AgreementRenterRow[]) {
  if (!renters.length) return "";
  if (renters.length === 1) return renters[0].name;
  return renters.map((r) => `Name Renter : ${r.name}`).join("\n");
}

export function formatRentersEmailsForPartiesSection(renters: AgreementRenterRow[]) {
  if (!renters.length) return "";
  if (renters.length === 1) return renters[0].email;
  return renters.map((r) => r.email).join("\n");
}

export function formatRentersEmailsForConsentClause(renters: AgreementRenterRow[]) {
  if (!renters.length) return "";
  if (renters.length === 1) return renters[0].email;
  return renters.map((r) => r.email).join(", ");
}

export function formatRentersRosterLabel(renters: AgreementRenterRow[]) {
  if (!renters.length) return "";
  return renters.map((r) => r.name).join(", ");
}

export function mergeTenantSignaturesIntoAgreement(
  agreementRaw: string | null,
  signers: Parameters<typeof tenantSignatureRecordsFromSigners>[0],
) {
  let existing: Record<string, unknown> = {};
  try {
    existing = agreementRaw ? JSON.parse(agreementRaw) : {};
  } catch {
    existing = {};
  }
  const tenant_signatures = tenantSignatureRecordsFromSigners(signers);
  return JSON.stringify({ ...existing, tenant_signatures });
}
