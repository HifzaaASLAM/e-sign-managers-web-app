import { getSignUrl, isLandlordWeeklyReport, isOnePartySignedDocumentType, isTenantAgreement } from "../shm/documents";

export type DashboardSigner = {
  name: string;
  email: string;
  role: string;
  signerType: string;
  status: string;
  signingUrl: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  /** Compact audit label for dashboard list (viewed / not viewed / signed). */
  auditLabel: string;
};

export type FinalPdfStatus = "pending" | "processing" | "ready" | "error";

export type DashboardAttachment = {
  slot: string;
  fileName: string;
};

export type DashboardDoc = {
  id: string;
  documentId: string;
  documentType: string;
  propertyAddress: string;
  status: string;
  title: string;
  createdAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  signedDriveUrl: string | null;
  documentLink: string;
  signAction: string | null;
  bothPartiesSigned: boolean;
  onePartyDocument: boolean;
  attachmentCount: number;
  attachments: DashboardAttachment[];
  finalPdfUrl: string | null;
  finalPdfStatus: FinalPdfStatus;
  finalPdfLabel: string;
  creator: DashboardSigner;
  /** Primary recipient (legacy); use `recipients` for all co-signers. */
  recipient: DashboardSigner;
  recipients: DashboardSigner[];
  /** Tenant Agreement: only tenant + landlord sign; hide creator row on dashboard. */
  hideCreatorSigner: boolean;
};

type RawSigner = {
  id: string;
  name: string;
  email: string;
  role: string;
  signerType: string;
  status: string;
  signingUrl: string | null;
  viewedAt: Date | null;
  signedAt: Date | null;
};

function formatAuditTimestamp(value: Date | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function buildSignerAuditLabel(status: string, viewedAt: Date | null, signedAt: Date | null) {
  if (status === "Signed") {
    const when = formatAuditTimestamp(signedAt);
    return when ? `Signed · ${when}` : "Signed";
  }
  if (viewedAt || status === "Viewed" || status === "Opened") {
    const when = formatAuditTimestamp(viewedAt);
    return when ? `Viewed · ${when}` : "Viewed";
  }
  return "Not viewed yet";
}

type RawDoc = {
  id: string;
  documentId: string;
  documentType: string;
  propertyAddress: string;
  status: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: string;
  adminName: string | null;
  adminEmail: string | null;
  adminToken: string | null;
  adminSignedAt: Date | null;
  tenantSignedAt: Date | null;
  signedAt: Date | null;
  viewedAt: Date | null;
  openedAt: Date | null;
  sentAt: Date | null;
  signingUrl: string | null;
  signedDriveUrl: string | null;
  agreementData?: string | null;
  createdAt: Date;
  signers: Array<{
    signerType: string;
    name: string;
    email: string;
    role: string;
    status: string;
    signingUrl: string | null;
    token: string;
    viewedAt: Date | null;
    openedAt: Date | null;
    signedAt: Date | null;
    sentAt: Date | null;
  }>;
};

function recipientSortKey(role: string) {
  if (/rental provider|landlord/i.test(String(role || ""))) return 2;
  return 1;
}

function mapStoredRecipientSigner(
  doc: RawDoc,
  s: RawDoc["signers"][number],
): RawSigner {
  const signingUrl =
    s.signingUrl || (s.token ? getSignUrl(doc.documentId, s.token, "recipient") : null);
  return {
    id: `${s.signerType}-${s.email}`,
    name: s.name,
    email: s.email,
    role: s.role,
    signerType: s.signerType,
    status: s.status,
    signingUrl,
    viewedAt: s.viewedAt || s.openedAt || null,
    signedAt: s.signedAt,
  };
}

function appendTenantAgreementExtraRecipients(doc: RawDoc, recipients: RawSigner[]): RawSigner[] {
  if (!isTenantAgreement(doc.documentType)) return recipients;

  let agreement: Record<string, unknown> = {};
  try {
    agreement = doc.agreementData ? (JSON.parse(doc.agreementData) as Record<string, unknown>) : {};
  } catch {
    agreement = {};
  }

  const extra = agreement.extra_signing_recipients;
  if (!Array.isArray(extra)) return recipients;

  const existingEmails = new Set(recipients.map((r) => String(r.email || "").trim().toLowerCase()).filter(Boolean));
  const out = [...recipients];

  for (const row of extra) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const email = String(item.email || "").trim().toLowerCase();
    const name = String(item.name || "").trim();
    if (!name || !email.includes("@") || existingEmails.has(email)) continue;

    const ccOnly = item.cc !== false;
    out.push({
      id: `extra-${email}`,
      name,
      email,
      role: ccOnly ? "CC" : "Additional signer",
      signerType: "recipient",
      status: ccOnly ? "CC" : "Not Sent",
      signingUrl: null,
      viewedAt: null,
      signedAt: null,
    });
    existingEmails.add(email);
  }

  return out;
}

function resolveSigners(doc: RawDoc): { creator: RawSigner; recipient: RawSigner; recipients: RawSigner[] } {
  const storedCreator = doc.signers.find((s) => s.signerType === "creator");
  const storedRecipients = doc.signers
    .filter((s) => s.signerType === "recipient" && s.status !== "Removed")
    .sort(
      (a, b) =>
        recipientSortKey(a.role) - recipientSortKey(b.role)
        || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  const creator: RawSigner = storedCreator
    ? {
        ...storedCreator,
        id: storedCreator.signerType,
        signingUrl:
          storedCreator.signingUrl
          || (storedCreator.token ? getSignUrl(doc.documentId, storedCreator.token, "creator") : null),
        viewedAt: storedCreator.viewedAt || storedCreator.openedAt || null,
        signedAt: storedCreator.signedAt,
      }
    : {
        id: `legacy-creator-${doc.documentId}`,
        name: doc.adminName || "Creator",
        email: doc.adminEmail || "",
        role: "Creator",
        signerType: "creator",
        status: doc.adminSignedAt ? "Signed" : "Not Signed",
        signingUrl: doc.adminToken ? getSignUrl(doc.documentId, doc.adminToken, "creator") : null,
        viewedAt: doc.viewedAt || doc.openedAt || null,
        signedAt: doc.adminSignedAt,
      };

  const legacyRecipient: RawSigner = {
    id: `legacy-recipient-${doc.documentId}`,
    name: doc.recipientName,
    email: doc.recipientEmail,
    role: doc.recipientRole,
    signerType: "recipient",
    status:
      doc.tenantSignedAt || doc.signedAt
        ? "Signed"
        : doc.viewedAt
          ? "Viewed"
          : doc.openedAt
            ? "Opened"
            : doc.sentAt
              ? "Sent"
              : "Not Sent",
    signingUrl: doc.signingUrl || null,
    viewedAt: doc.viewedAt || doc.openedAt || null,
    signedAt: doc.signedAt || doc.tenantSignedAt || null,
  };

  let recipients =
    storedRecipients.length > 0
      ? storedRecipients.map((s) => mapStoredRecipientSigner(doc, s))
      : [legacyRecipient];

  recipients = appendTenantAgreementExtraRecipients(doc, recipients);

  const recipient = recipients[0] ?? legacyRecipient;

  return { creator, recipient, recipients };
}

function toDashboardSigner(s: RawSigner): DashboardSigner {
  return {
    name: s.name,
    email: s.email,
    role: s.role,
    signerType: s.signerType,
    status: s.status,
    signingUrl: s.signingUrl,
    viewedAt: s.viewedAt?.toISOString() ?? null,
    signedAt: s.signedAt?.toISOString() ?? null,
    auditLabel: buildSignerAuditLabel(s.status, s.viewedAt, s.signedAt),
  };
}

export function buildDocumentTitle(doc: RawDoc, recipientName: string) {
  const parts = [recipientName, doc.propertyAddress, doc.documentType].filter(Boolean);
  return parts.join(" - ");
}

export function buildFinalPdfLabel(documentType: string, documentId: string) {
  const safeType = documentType.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return `${safeType || "Document"}-${documentId}-Signed.pdf`;
}

export function resolveFinalPdfState(
  complete: boolean,
  status: string,
  signedDriveUrl: string | null,
  documentType: string,
  documentId: string,
): { finalPdfUrl: string | null; finalPdfStatus: FinalPdfStatus; finalPdfLabel: string } {
  const finalPdfLabel = buildFinalPdfLabel(documentType, documentId);

  if (!complete) {
    return { finalPdfUrl: null, finalPdfStatus: "pending", finalPdfLabel };
  }
  if (status === "Make Error") {
    return { finalPdfUrl: null, finalPdfStatus: "error", finalPdfLabel };
  }
  if (signedDriveUrl) {
    return { finalPdfUrl: signedDriveUrl, finalPdfStatus: "ready", finalPdfLabel };
  }
  return { finalPdfUrl: null, finalPdfStatus: "processing", finalPdfLabel };
}

function parseAttachmentList(agreementDataRaw: string | null | undefined): DashboardAttachment[] {
  if (!agreementDataRaw) return [];
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(agreementDataRaw) as Record<string, unknown>;
  } catch {
    return [];
  }

  const rows: DashboardAttachment[] = [];
  const manifest = data.attachment_manifest;
  if (Array.isArray(manifest)) {
    for (const item of manifest) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const fileName = String(row.fileName || row.name || "").trim();
      if (!fileName) continue;
      rows.push({ slot: String(row.slot || "other"), fileName });
    }
  }

  if (!rows.length && Array.isArray(data.attachment_names)) {
    for (const name of data.attachment_names) {
      const fileName = String(name || "").trim();
      if (!fileName) continue;
      const slot = fileName.includes("__") ? fileName.split("__")[0] : "other";
      rows.push({ slot, fileName });
    }
  }

  if (!rows.length && Array.isArray(data.uploaded_attachments)) {
    for (const item of data.uploaded_attachments) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const fileName = String(row.fileName || "").trim();
      if (!fileName) continue;
      const slot = fileName.includes("__") ? fileName.split("__")[0] : "other";
      rows.push({ slot, fileName });
    }
  }

  return rows.slice(0, 30);
}

export function serializeDashboardDocs(docs: RawDoc[]): DashboardDoc[] {
  return docs.map((doc) => {
    const { creator, recipient, recipients } = resolveSigners(doc);
    const onePartyDocument = isOnePartySignedDocumentType(doc.documentType);
    const weeklyReport = isLandlordWeeklyReport(doc.documentType);
    const hideCreatorSigner = isTenantAgreement(doc.documentType) || weeklyReport;
    const signingRecipients = hideCreatorSigner
      ? recipients.filter((r) => r.status !== "CC" && !/^cc$/i.test(String(r.role || "")))
      : recipients;
    const creatorNeedsSignature = !onePartyDocument && !hideCreatorSigner && creator.status !== "Signed";
    const allRecipientsSigned =
      signingRecipients.length > 0 && signingRecipients.every((r) => r.status === "Signed");
    const recipientNeedsSignature = !allRecipientsSigned;
    const bothPartiesSigned = onePartyDocument || hideCreatorSigner
      ? allRecipientsSigned
      : creator.status === "Signed" && allRecipientsSigned;
    const titleRecipientLabel =
      recipients.length > 1
        ? recipients.map((r) => r.name).filter(Boolean).join(", ")
        : recipient.name;
    const documentLink = doc.signedDriveUrl || recipient.signingUrl || doc.signingUrl || "#";
    const nextRecipientUrl =
      recipients.find((r) => r.status !== "Signed")?.signingUrl || recipient.signingUrl;
    const signAction = weeklyReport
      ? null
      : hideCreatorSigner
      ? recipientNeedsSignature
        ? nextRecipientUrl
        : null
      : creatorNeedsSignature
        ? creator.signingUrl
        : recipientNeedsSignature
          ? nextRecipientUrl
          : null;
    const finalPdf = resolveFinalPdfState(bothPartiesSigned, doc.status, doc.signedDriveUrl, doc.documentType, doc.documentId);
    const attachments = parseAttachmentList(doc.agreementData);

    return {
      id: doc.id,
      documentId: doc.documentId,
      documentType: doc.documentType,
      propertyAddress: doc.propertyAddress,
      status: doc.status,
      title: buildDocumentTitle(doc, titleRecipientLabel),
      createdAt: doc.createdAt.toISOString(),
      sentAt: doc.sentAt?.toISOString() ?? null,
      viewedAt: doc.viewedAt?.toISOString() ?? null,
      signedAt: doc.signedAt?.toISOString() ?? null,
      signedDriveUrl: doc.signedDriveUrl,
      documentLink,
      signAction,
      bothPartiesSigned,
      onePartyDocument,
      attachmentCount: attachments.length,
      attachments,
      finalPdfUrl: finalPdf.finalPdfUrl,
      finalPdfStatus: finalPdf.finalPdfStatus,
      finalPdfLabel: finalPdf.finalPdfLabel,
      creator: toDashboardSigner(creator),
      recipient: weeklyReport
        ? { ...toDashboardSigner(recipient), signingUrl: null, auditLabel: "" }
        : toDashboardSigner(recipient),
      recipients: recipients.map((row) => {
        const signer = toDashboardSigner(row);
        return weeklyReport ? { ...signer, signingUrl: null, auditLabel: "" } : signer;
      }),
      hideCreatorSigner,
    };
  });
}

export type ActivityPoint = { date: string; sent: number; viewed: number; signed: number };

export function buildActivitySeries(docs: DashboardDoc[], days = 30): ActivityPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sentByDay = new Map<string, number>();
  const viewedByDay = new Map<string, number>();
  const signedByDay = new Map<string, number>();

  const bump = (map: Map<string, number>, iso: string | null) => {
    if (!iso) return;
    const key = iso.slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const doc of docs) {
    bump(sentByDay, doc.sentAt || doc.createdAt);
    bump(viewedByDay, doc.viewedAt);
    bump(signedByDay, doc.signedAt);
  }

  const points: ActivityPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    points.push({
      date: key,
      sent: sentByDay.get(key) ?? 0,
      viewed: viewedByDay.get(key) ?? 0,
      signed: signedByDay.get(key) ?? 0,
    });
  }

  return points;
}

export function activityTotals(series: ActivityPoint[]) {
  return {
    sent: series.reduce((sum, p) => sum + p.sent, 0),
    viewed: series.reduce((sum, p) => sum + p.viewed, 0),
    signed: series.reduce((sum, p) => sum + p.signed, 0),
  };
}
