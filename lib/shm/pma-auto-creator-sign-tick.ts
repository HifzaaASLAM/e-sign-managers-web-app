import { isPropertyManagementAgreement } from "./documents";
import { runDuePmaAutoCreatorSigns } from "./property-management-agreement-auto-creator-sign";

type DocSlice = {
  documentId: string;
  documentType: string;
  adminSignedAt: Date | null;
  tenantSignedAt: Date | null;
  signedAt: Date | null;
};

export function listPmaDocsAwaitingCreatorAutoSign(docs: DocSlice[]) {
  return docs.filter(
    (d) =>
      isPropertyManagementAgreement(d.documentType)
      && !d.adminSignedAt
      && Boolean(d.tenantSignedAt || d.signedAt),
  );
}

/** Hostinger kills in-request timers after owner sign — run due jobs on the next dashboard load. */
export function triggerDuePmaAutoCreatorSignsInBackground(documentIds?: string[]) {
  void runDuePmaAutoCreatorSigns(undefined, {
    documentIds: documentIds?.length ? documentIds : undefined,
    max: documentIds?.length ? Math.min(documentIds.length, 5) : 3,
  }).catch((error) => {
    console.error("[pma-auto-creator-sign-tick]", error);
  });
}
