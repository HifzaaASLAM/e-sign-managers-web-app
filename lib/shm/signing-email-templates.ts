/**
 * Defaults and HTML rendering for signer-facing emails (Send new, re-send, TA admin-send).
 */

export const SIGNING_EMAIL_AGREEMENT_KEY = "signing_email";
export const SIGNING_EMAIL_PROVIDER_AGREEMENT_KEY = "signing_email_provider";

export type SigningEmailStoredContent = {
  subject?: string;
  body?: string;
};

export type SigningEmailRenderInput = {
  documentType: string;
  recipientName: string;
  recipientEmail: string;
  signingUrl: string;
  propertyAddress?: string;
  documentId?: string;
  subject?: string;
  body?: string;
  /** Preview mode uses a placeholder link label */
  preview?: boolean;
  hasDocxAttachment?: boolean;
  hasAnyAttachment?: boolean;
};

export const SIGNING_EMAIL_BRAND = {
  orange: "#F57E20",
  dark: "#1C1C1C",
  muted: "#5B5B5B",
  light: "#F4F4F4",
  border: "#E6E7E8",
} as const;

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normType(documentType: string) {
  return String(documentType || "").trim().toLowerCase();
}

export function isTenantApplicationDocumentType(documentType: string) {
  return normType(documentType).includes("tenant application");
}

export function isPropertyManagementAgreementDocumentType(documentType: string) {
  return normType(documentType).includes("property management agreement");
}

export function getDefaultSigningEmailSubject(documentType: string): string {
  if (isTenantApplicationDocumentType(documentType)) {
    return "Your Tenant Application — ShareHouseManagers";
  }
  const type = String(documentType || "Document").trim();
  return `Action Required: Please Sign Your ${type}`;
}

export function getDefaultSigningEmailSubjectForRentalProvider(documentType: string): string {
  const type = String(documentType || "Tenant Agreement").trim();
  return `Action Required: Sign Your ${type} as Residential Rental Provider`;
}

export function getDefaultSigningEmailBodyForRentalProvider(documentType: string): string {
  const type = String(documentType || "Tenant Agreement").trim();
  return [
    `You are listed as the Residential Rental Provider on this ${type}.`,
    "",
    "Please review the co-tenancy agreement carefully. Once you are satisfied with the terms, sign using the secure link below.",
    "",
    "[[PROPERTY_BLOCK]]",
    "",
    "[[ATTACHMENT_NOTE]]",
    "",
    "The renter will also receive their own signing link. The agreement is completed once both parties have signed.",
    "",
    "This link is single-use and tied to your email address.",
  ].join("\n");
}

export function signingEmailContentForRentalProvider(
  documentType: string,
  agreementDataRaw?: string | null,
): SigningEmailStoredContent {
  const agreementData = parseAgreementDataJson(agreementDataRaw);
  const storedProvider = readSigningEmailProviderFromAgreement(agreementData);
  const storedTenant = readSigningEmailFromAgreement(agreementData);
  const providerName = String(agreementData.provider_name || "").trim();
  let body = getDefaultSigningEmailBodyForRentalProvider(documentType);
  if (providerName) {
    body = body.replace(/\bthe landlord\b/gi, providerName);
  }
  return {
    subject:
      storedProvider?.subject ||
      getDefaultSigningEmailSubjectForRentalProvider(documentType),
    body: storedProvider?.body || storedTenant?.body || body,
  };
}

export function getDefaultSigningEmailBody(documentType: string): string {
  if (isTenantApplicationDocumentType(documentType)) {
    return [
      "ShareHouseManagers welcomes you and thanks you for your interest in the property.",
      "",
      "[[PROPERTY_BLOCK]]",
      "",
      "Please find below the link to our tenancy application form sent through our e-sign portal.",
      "",
      "Kindly complete the form carefully and ensure that all mandatory fields are filled in correctly. Please make sure the information provided is accurate and complete so your application can be processed without delay.",
      "",
      "If you have any difficulty accessing or completing the form, please let us know.",
    ].join("\n");
  }

  return [
    "Please review and sign your {{document_type}}.",
    "",
    "[[PROPERTY_BLOCK]]",
    "",
    "[[ATTACHMENT_NOTE]]",
    "",
    "Click the button below to open your document. This link is single-use and tied to your email address.",
  ].join("\n");
}

export function readSigningEmailFromAgreement(
  agreementData: Record<string, unknown> | null | undefined,
): SigningEmailStoredContent | null {
  if (!agreementData) return null;
  const raw = agreementData[SIGNING_EMAIL_AGREEMENT_KEY];
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subject = String(row.subject || "").trim();
  const body = String(row.body || "").trim();
  if (!subject && !body) return null;
  return { subject: subject || undefined, body: body || undefined };
}

export function readSigningEmailProviderFromAgreement(
  agreementData: Record<string, unknown> | null | undefined,
): SigningEmailStoredContent | null {
  if (!agreementData) return null;
  const raw = agreementData[SIGNING_EMAIL_PROVIDER_AGREEMENT_KEY];
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subject = String(row.subject || "").trim();
  const body = String(row.body || "").trim();
  if (!subject && !body) return null;
  return { subject: subject || undefined, body: body || undefined };
}

export function mergeSigningEmailIntoAgreement(
  agreementData: Record<string, unknown>,
  content: SigningEmailStoredContent,
): Record<string, unknown> {
  const subject = String(content.subject || "").trim();
  const body = String(content.body || "").trim();
  if (!subject && !body) return agreementData;
  return {
    ...agreementData,
    [SIGNING_EMAIL_AGREEMENT_KEY]: {
      ...(subject ? { subject } : {}),
      ...(body ? { body } : {}),
    },
  };
}

export function parseAgreementDataJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function signingEmailContentForDocument(
  documentType: string,
  agreementDataRaw: string | null | undefined,
): SigningEmailStoredContent {
  const fromAgreement = readSigningEmailFromAgreement(parseAgreementDataJson(agreementDataRaw));
  return {
    subject: fromAgreement?.subject || getDefaultSigningEmailSubject(documentType),
    body: fromAgreement?.body || getDefaultSigningEmailBody(documentType),
  };
}

function shouldShowPropertyBlock(documentType: string, propertyAddress: string) {
  const raw = propertyAddress.trim();
  if (!raw || raw.toLowerCase() === "the listed property") return false;
  if (isPropertyManagementAgreementDocumentType(documentType)) return false;
  return true;
}

function propertyBlockHtml(address: string, variant: "standard" | "tenant_application") {
  const { orange, light, dark, muted } = SIGNING_EMAIL_BRAND;
  const escaped = escapeHtml(address);
  if (variant === "tenant_application") {
    return `<p style="margin:0 0 18px;padding:14px 16px;background:${light};border-left:4px solid ${orange};border-radius:4px;font-size:15px;font-weight:700;color:${dark};">${escaped}</p>`;
  }
  return `<p style="background:${light};padding:12px 16px;border-radius:5px;border-left:4px solid ${orange};font-weight:600;">${escaped}</p>`;
}

function attachmentNoteHtml(hasDocxAttachment: boolean, hasAnyAttachment: boolean) {
  if (!hasAnyAttachment) return "";
  const { muted } = SIGNING_EMAIL_BRAND;
  const text = hasDocxAttachment
    ? "A copy of the agreement is attached as a Word document (.docx) for your records. Open it in Microsoft Word if your email preview looks distorted."
    : "A copy of the agreement is attached to this email for your records.";
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${muted};">${text} Please complete your signature online using the button below.</p>`;
}

function applyPlaceholders(text: string, documentType: string) {
  return text
    .replace(/\{\{document_type\}\}/gi, documentType)
    .replace(/\[\[DOCUMENT_TYPE\]\]/gi, documentType);
}

/** Strip tags and limit length for signer-edited body text. */
export function sanitizeSigningEmailBodyPlain(raw: string): string {
  const withoutTags = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n");
  return withoutTags.trim().slice(0, 12000);
}

export function sanitizeSigningEmailSubject(raw: string, documentType: string): string {
  const cleaned = raw.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  return cleaned || getDefaultSigningEmailSubject(documentType);
}

export function buildSigningEmailAgreementPatch(
  documentType: string,
  subject?: string | null,
  body?: string | null,
): Record<string, unknown> {
  const stored: SigningEmailStoredContent = {
    subject: sanitizeSigningEmailSubject(String(subject || ""), documentType),
    body: sanitizeSigningEmailBodyPlain(String(body || "") || getDefaultSigningEmailBody(documentType)),
  };
  return mergeSigningEmailIntoAgreement({}, stored);
}

export function mergeSigningEmailPatchIntoJson(
  agreementDataJson: string | null | undefined,
  documentType: string,
  subject?: string | null,
  body?: string | null,
): string {
  const base = parseAgreementDataJson(agreementDataJson);
  const merged = mergeSigningEmailIntoAgreement(base, {
    subject: sanitizeSigningEmailSubject(String(subject || ""), documentType),
    body: sanitizeSigningEmailBodyPlain(String(body || "") || getDefaultSigningEmailBody(documentType)),
  });
  return JSON.stringify(merged);
}

function plainBodyToParagraphsHtml(bodyPlain: string, mutedColor: string, fontSize = "16px") {
  const paragraphs = bodyPlain
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:${fontSize};line-height:1.7;color:${mutedColor};">${escapeHtml(p)}</p>`,
    )
    .join("");
}

function renderBodyContentHtml(input: SigningEmailRenderInput): string {
  const documentType = input.documentType.trim();
  const isTenantApplication = isTenantApplicationDocumentType(documentType);
  const showProperty = shouldShowPropertyBlock(documentType, input.propertyAddress || "");
  const bodyTemplate = sanitizeSigningEmailBodyPlain(
    input.body || getDefaultSigningEmailBody(documentType),
  );
  const withTypes = applyPlaceholders(bodyTemplate, documentType);

  const parts = withTypes.split("[[PROPERTY_BLOCK]]");
  const attachmentMarker = "[[ATTACHMENT_NOTE]]";
  const { muted } = SIGNING_EMAIL_BRAND;

  const renderSegment = (segment: string, fontSize?: string) => {
    if (!segment.includes(attachmentMarker)) {
      return plainBodyToParagraphsHtml(segment, muted, fontSize);
    }
    const [before, after] = segment.split(attachmentMarker);
    const attachmentHtml = attachmentNoteHtml(
      Boolean(input.hasDocxAttachment),
      Boolean(input.hasAnyAttachment),
    );
    return (
      plainBodyToParagraphsHtml(before, muted, fontSize)
      + attachmentHtml
      + plainBodyToParagraphsHtml(after, muted, fontSize)
    );
  };

  if (parts.length === 1) {
    return renderSegment(parts[0], isTenantApplication ? undefined : "16px");
  }

  const propertyHtml = showProperty
    ? propertyBlockHtml(
        (input.propertyAddress || "").trim(),
        isTenantApplication ? "tenant_application" : "standard",
      )
    : "";

  if (isTenantApplication) {
    return parts
      .map((part, idx) => {
        const html = renderSegment(part);
        if (idx === 0 && propertyHtml) return html + propertyHtml;
        return html;
      })
      .join("");
  }

  // Standard: first segment may need property intro tweak when address present
  let first = parts[0] || "";
  if (showProperty && !first.toLowerCase().includes("for the property")) {
    first = first.replace(
      /\{\{document_type\}\}/gi,
      documentType,
    );
    if (!first.includes(documentType)) {
      first = `Please review and sign your ${documentType} for the property at:`;
    }
  }

  return (
    renderSegment(first)
    + propertyHtml
    + parts.slice(1).map((p) => renderSegment(p)).join("")
  );
}

export function resolveSigningEmailSubject(input: SigningEmailRenderInput): string {
  const custom = String(input.subject || "").trim();
  return sanitizeSigningEmailSubject(custom, input.documentType);
}

export function renderSigningEmailHtml(input: SigningEmailRenderInput): string {
  const {
    orange,
    dark,
    muted,
    light,
    border,
  } = SIGNING_EMAIL_BRAND;
  const name = escapeHtml(input.recipientName || "there");
  const to = escapeHtml((input.recipientEmail || "").trim().toLowerCase());
  const documentId = escapeHtml(input.documentId || "");
  const signingUrl = input.preview ? "#" : input.signingUrl;
  const isTenantApplication = isTenantApplicationDocumentType(input.documentType);
  const bodyHtml = renderBodyContentHtml(input);
  const buttonLabel = isTenantApplication ? "Open and Sign" : "Review &amp; Sign Document";

  if (isTenantApplication) {
    return `
    <html><body style="margin:0;padding:0;background:${light};font-family:Arial,Helvetica,sans-serif;color:${dark};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${light};padding:28px 16px;">
        <tr><td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${dark};padding:22px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <div style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${orange};margin-right:10px;vertical-align:middle;"></div>
                      <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px;vertical-align:middle;">ShareHouseManagers</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height:4px;background:${orange};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 28px 16px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ${name},</p>
                ${bodyHtml}
                <div style="text-align:center;margin:28px 0 12px;">
                  <a href="${signingUrl}" style="background:${orange};color:#ffffff;padding:14px 34px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">${buttonLabel}</a>
                </div>
                <p style="margin:20px 0 0;font-size:12px;line-height:1.7;color:#8A8A8A;">
                  ${documentId ? `Document ID: ${documentId}<br>` : ""}
                  This link is unique to <strong style="color:${dark};">${to || "the recipient"}</strong>. Please do not share or forward this email.<br>
                  After you sign, the link will stop working.<br>
                  Need help? Contact us at <a href="mailto:info@sharehousemanagers.com.au" style="color:${orange};text-decoration:none;">info@sharehousemanagers.com.au</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:${dark};padding:16px 28px;text-align:center;">
                <p style="margin:0;font-size:12px;color:#C9C9C9;line-height:1.6;">
                  © ShareHouseManagers · <a href="https://sharehousemanagers.com.au/" style="color:${orange};text-decoration:none;">sharehousemanagers.com.au</a>
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;
  }

  return `
    <html><body style="font-family:Arial,sans-serif;color:${dark};max-width:600px;margin:0 auto;background:${light};padding:24px;">
      <div style="background:${dark};padding:28px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">ShareHouseManagers</h1>
      </div>
      <div style="height:4px;background:${orange};"></div>
      <div style="background:#fff;padding:32px;border:1px solid ${border};border-top:none;border-radius:0 0 8px 8px;">
        <p>Dear ${name},</p>
        ${bodyHtml}
        <div style="text-align:center;margin:28px 0;">
          <a href="${signingUrl}" style="background:${orange};color:#fff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">${buttonLabel}</a>
        </div>
        <p style="font-size:12px;color:#999;line-height:1.6;">
          ${documentId ? `Document ID: ${documentId}<br>` : ""}
          This link is unique to <strong>${to || "the recipient"}</strong>. Do not share or forward this email.<br>
          After you sign, the link will stop working.<br>
          If you did not expect this email, please contact us.
        </p>
      </div>
    </body></html>`;
}
