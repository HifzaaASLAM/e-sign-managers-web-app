import { createToken, getSignUrl } from "./documents";
import { normalizePmaAgreementStorage, parsePmaAgreementData } from "./property-management-agreement-fields";

/** Fresh owner token + cleared owner signature when agency re-sends an amended PMA. */
export function buildPmaOwnerResendSigningLink(documentId: string) {
  const recipientToken = createToken();
  const signingUrl = getSignUrl(documentId, recipientToken, "recipient");
  return { recipientToken, signingUrl };
}

export function stripPmaOwnerSignaturesFromAgreement(raw: Record<string, unknown>) {
  const base = normalizePmaAgreementStorage({ ...raw });
  delete base.pma_sig;
  delete base.tenant_signature;
  delete base.owner_signature;
  delete base.signature;
  if (base.last_submission && typeof base.last_submission === "object") {
    const last = { ...(base.last_submission as Record<string, unknown>) };
    delete last.signature;
    delete last.owner_signature;
    delete last.tenant_signature;
    base.last_submission = last;
  }
  return base;
}

export function mergePmaAgreementForOwnerResend(storedRaw: string | null, mergedFields: Record<string, unknown>) {
  const stored = parsePmaAgreementData(storedRaw);
  return stripPmaOwnerSignaturesFromAgreement(
    normalizePmaAgreementStorage({
      ...stored,
      ...mergedFields,
    }),
  );
}
