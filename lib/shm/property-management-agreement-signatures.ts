import { loadCreatorAutoSignatureDataUrl } from "./creator-auto-signature";

export function isUsableSignatureDataUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("[omitted")) return false;
  if (raw.startsWith("data:image/")) return true;
  if (raw.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(raw.replace(/\s/g, ""))) return true;
  return false;
}

export function normalizeSignatureDataUrl(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("[omitted")) return undefined;
  if (raw.startsWith("data:image/")) return raw;
  const compact = raw.replace(/\s/g, "");
  if (compact.length > 200 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  return undefined;
}

type SignerRow = {
  signerType: string;
  status: string;
  signature: string | null;
};

type DocSigSource = {
  tenantSignature: string | null;
  adminSignature: string | null;
  adminSignedAt: Date | null;
  tenantSignedAt?: Date | null;
  signedAt?: Date | null;
};

/** Resolve owner + agent signature images for final PMA DOCX (DB + auto-creator asset fallback). */
export async function resolvePmaSignatureDataUrls(input: {
  signers: SignerRow[];
  doc: DocSigSource;
  agreementData: Record<string, unknown>;
}) {
  const recipient = input.signers.find((s) => s.signerType === "recipient" && s.status !== "Removed");
  const creator = input.signers.find((s) => s.signerType === "creator");
  const data = input.agreementData;

  const ownerRaw =
    recipient?.signature
    || input.doc.tenantSignature
    || data.signature
    || data.pma_sig
    || data.owner_signature
    || data.tenant_signature;
  let ownerSignature = normalizeSignatureDataUrl(ownerRaw);

  const agentRaw =
    creator?.signature
    || input.doc.adminSignature
    || data.agent_signature
    || data.pma_agent_sig
    || data.admin_signature;
  let agentSignature = normalizeSignatureDataUrl(agentRaw);

  const creatorSigned =
    creator?.status === "Signed"
    || Boolean(input.doc.adminSignedAt);
  const recipientSigned =
    recipient?.status === "Signed"
    || Boolean(input.doc.tenantSignedAt || input.doc.signedAt);

  if (creatorSigned && !agentSignature) {
    const fallbackAgent = normalizeSignatureDataUrl(await loadCreatorAutoSignatureDataUrl());
    if (fallbackAgent) agentSignature = fallbackAgent;
  }

  if (recipientSigned && !ownerSignature && isUsableSignatureDataUrl(recipient?.signature)) {
    ownerSignature = normalizeSignatureDataUrl(recipient?.signature);
  }

  return {
    ownerSignature,
    agentSignature,
    creatorSigned,
    recipientSigned,
  };
}
