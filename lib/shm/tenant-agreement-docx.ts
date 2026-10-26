import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import { buildTenantAgreementTemplateData } from "./tenant-agreement-export";
import { mergeDocxRuns } from "./docx-utils";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceAll(xml: string, needle: string, value: string) {
  if (!needle || !xml.includes(needle)) return xml;
  return xml.split(needle).join(escapeXml(value));
}

/** Find the real <w:p ...> element that contains idx (not <w:pPr>, <w:pgSz>, etc.). */
function findEnclosingParagraphRange(xml: string, idx: number): { start: number; end: number } | null {
  const openRe = /<w:p(?:\s[^>]*)?>/g;
  let start = -1;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(xml)) !== null) {
    if (match.index > idx) break;
    start = match.index;
  }
  if (start === -1) return null;
  const close = xml.indexOf("</w:p>", idx);
  if (close === -1 || close < start) return null;
  return { start, end: close + "</w:p>".length };
}

/** Match template styles after "4. Period": Arial headings #0F172A 13pt, body #1E1E1E 9pt. */
const DOC_FONT = "Arial";
const HEADING_COLOR = "0F172A";
const BODY_COLOR = "1E1E1E";
const HEADING_SIZE = "26"; // half-points = 13pt
const BODY_SIZE = "18"; // half-points = 9pt

function runProps(opts: { bold?: boolean; heading?: boolean }) {
  const bold = opts.bold || opts.heading ? "<w:b/><w:bCs/>" : "";
  const color = opts.heading ? HEADING_COLOR : BODY_COLOR;
  const size = opts.heading ? HEADING_SIZE : BODY_SIZE;
  return (
    `<w:rPr>` +
    `<w:rFonts w:ascii="${DOC_FONT}" w:hAnsi="${DOC_FONT}" w:eastAsia="${DOC_FONT}" w:cs="${DOC_FONT}"/>` +
    `${bold}` +
    `<w:color w:val="${color}"/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `</w:rPr>`
  );
}

function paragraphsFromMultiline(value: string, options?: { boldLeadLines?: boolean }) {
  const boldLead = options?.boldLeadLines !== false;
  const normalized = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();

  if (!normalized) {
    return '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>';
  }

  const lines = normalized.split("\n").map((line) => line.trimEnd());
  const paras: string[] = [];
  let expectHeading = true;

  for (const line of lines) {
    if (!line.trim()) {
      expectHeading = true;
      paras.push('<w:p><w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr></w:p>');
      continue;
    }

    const text = escapeXml(line);
    const treatAsHeading = boldLead && expectHeading;

    if (treatAsHeading) {
      paras.push(
        `<w:p><w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr>` +
          `<w:r>${runProps({ heading: true })}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
      );
    } else {
      paras.push(
        `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>` +
          `<w:r>${runProps({ heading: false })}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
      );
    }
    expectHeading = false;
  }

  return paras.join("") || '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>';
}

function replacePlaceholderParagraph(xml: string, needle: string, value: string, options?: { boldLeadLines?: boolean }) {
  if (!needle || !xml.includes(needle)) return xml;

  const parasXml = paragraphsFromMultiline(value, options);
  let out = xml;
  let guard = 0;
  while (out.includes(needle) && guard < 20) {
    guard += 1;
    const idx = out.indexOf(needle);
    const range = findEnclosingParagraphRange(out, idx);
    if (!range) {
      const lines = String(value || "").split(/\r?\n/);
      const withBreaks = lines
        .map((line) => escapeXml(line))
        .join('</w:t><w:br/><w:t xml:space="preserve">');
      out = out.split(needle).join(withBreaks);
      break;
    }
    out = out.slice(0, range.start) + parasXml + out.slice(range.end);
  }
  return out;
}

function decodeDataUri(dataUri: string) {
  const raw = String(dataUri || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) return Buffer.from(match[2], "base64");
  return Buffer.from(raw, "base64");
}

function getSignatureInfo(dataUrl: string | undefined): { ext: string; buffer: Buffer } | null {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (match) {
    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    return { ext, buffer: Buffer.from(match[2], "base64") };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.length > 40) {
    try {
      return { ext: "png", buffer: Buffer.from(raw, "base64") };
    } catch {
      return null;
    }
  }
  return null;
}

function para(text: string, opts?: { bold?: boolean; before?: number; after?: number; size?: number }) {
  const bold = opts?.bold ? "<w:b/><w:bCs/>" : "";
  const before = opts?.before ?? 80;
  const after = opts?.after ?? 60;
  const size = opts?.size ?? 20;
  return (
    `<w:p>` +
    `<w:pPr><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>` +
    `<w:r><w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function signatureDrawingParagraph(relId: string, name: string, docPrId: number) {
  const cx = 2400000;
  const cy = 800000;
  const safe = escapeXml(name);
  return (
    `<w:p><w:pPr><w:spacing w:before="120" w:after="40"/></w:pPr>` +
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="${safe}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${safe}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

/**
 * The template's Acknowledgement / signatures / Audit trail block is often
 * orphaned <w:tr>/<w:tc> rows (missing parent <w:tbl>), so Word hides it. Rebuild as
 * plain paragraphs that always render, with real signature drawings when available.
 */
function rebuildSignatureAndAuditSection(
  xml: string,
  d: ReturnType<typeof buildTenantAgreementTemplateData>,
  options?: { tenantRelId?: string; providerRelId?: string },
) {
  const markers = ["Electronic Signatures", "Acknowledgement", "I hereby acknowledge", "Audit trail"];
  let markerIdx = -1;
  for (const marker of markers) {
    const idx = xml.indexOf(marker);
    if (idx !== -1 && (markerIdx === -1 || idx < markerIdx)) markerIdx = idx;
  }
  if (markerIdx === -1) return xml;

  // Prefer cutting at the paragraph/row that starts this block.
  let start = markerIdx;
  const tr = xml.lastIndexOf("<w:tr", markerIdx);
  const p = findEnclosingParagraphRange(xml, markerIdx);
  if (tr !== -1 && tr > markerIdx - 8000) start = tr;
  else if (p) start = p.start;

  // End at the orphaned table close before sectPr, or at sectPr itself.
  const sect = xml.indexOf("<w:sectPr", markerIdx);
  if (sect === -1) return xml;
  let end = sect;
  const tblClose = xml.lastIndexOf("</w:tbl>", sect);
  if (tblClose > start) end = tblClose + "</w:tbl>".length;

  const tenantSig = options?.tenantRelId
    ? signatureDrawingParagraph(options.tenantRelId, "Tenant Signature", 9501)
    : para("(Tenant signature)", { after: 40 });
  const providerSig = options?.providerRelId
    ? signatureDrawingParagraph(options.providerRelId, "Provider Signature", 9502)
    : para("(Provider signature)", { after: 40 });

  const block =
    para("Acknowledgement", { bold: true, before: 280, after: 80, size: 24 }) +
    para(
      "I hereby acknowledge that I have read and understood the above conditions.",
      { before: 40, after: 160 },
    ) +
    para("Tenant / Renter", { bold: true, before: 200, after: 40 }) +
    tenantSig +
    para(String(d.tenant_name_roster || d.tenant_name || "________________"), { before: 40, after: 20 }) +
    para(`Email: ${String(d.tenant_email_roster || d.tenant_email || "________________")}`, { before: 0, after: 20 }) +
    para(d.signed_datetime || "", { before: 0, after: 120 }) +
    para("Rental Provider", { bold: true, before: 80, after: 40 }) +
    providerSig +
    para(d.provider_name || "________________", { before: 40, after: 20 }) +
    para(`Email: ${d.provider_email || "________________"}`, { before: 0, after: 20 }) +
    para(d.signed_datetime || "", { before: 0, after: 160 }) +
    para("Audit trail", { bold: true, before: 200, after: 100, size: 24 }) +
    para(d.audit_sent_tenant, { before: 40, after: 40 }) +
    para(d.audit_sent_provider, { before: 0, after: 40 }) +
    para(d.audit_viewed, { before: 0, after: 40 }) +
    para(d.audit_verified, { before: 0, after: 40 }) +
    para(d.audit_signed, { before: 0, after: 40 }) +
    para(d.audit_finalized, { before: 0, after: 40 }) +
    para(`ID: ${d.document_id || "________________"}`, { bold: true, before: 80, after: 120 });

  return xml.slice(0, start) + block + xml.slice(end);
}

function normalizeSignatureBlock(xml: string) {
  const emailNeedle = "Email: [[TENANT_EMAIL_SIG]]";
  const first = xml.indexOf(emailNeedle);
  if (first === -1) return xml;
  const second = xml.indexOf(emailNeedle, first + emailNeedle.length);
  if (second === -1) return xml;
  return (
    xml.slice(0, second) +
    "Email: [[PROVIDER_EMAIL_SIG]]" +
    xml.slice(second + emailNeedle.length)
  );
}

function addImageContentTypeIfNeeded(zip: PizZip, ext: string) {
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return;
  let ct = ctFile.asText();
  if (ct.includes(`Extension="${ext}"`)) return;
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "application/octet-stream";
  ct = ct.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
  zip.file("[Content_Types].xml", ct);
}

function replaceFirstPlaceholderParagraph(xml: string, needle: string, value: string) {
  if (!needle || !xml.includes(needle)) return xml;
  const idx = xml.indexOf(needle);
  const range = findEnclosingParagraphRange(xml, idx);
  const parasXml = paragraphsFromMultiline(value, { boldLeadLines: false });
  if (!range) return replaceAll(xml, needle, value);
  return xml.slice(0, range.start) + parasXml + xml.slice(range.end);
}

function applyTemplatePlaceholders(
  xml: string,
  data: Record<string, unknown>,
  extras?: { documentId?: string; signedAt?: Date; signers?: Parameters<typeof buildTenantAgreementTemplateData>[1]["signers"] },
) {
  const d = buildTenantAgreementTemplateData(data, extras);
  const tenantSigName = String(d.tenant_name_roster || d.tenant_name || "");
  const tenantSigEmail = String(d.tenant_email_roster || d.tenant_email || "");
  const tenantEmailConsent = String(d.tenant_email_consent || d.tenant_email || "");
  let out = normalizeSignatureBlock(mergeDocxRuns(xml));

  const pairs: Array<[string, string]> = [
    ["[[AGREEMENT_DATE]]", d.agreement_date],
    ["[[PROVIDER_NAME_SIG]]", d.provider_name],
    ["[[PROVIDER_EMAIL_SIG]]", d.provider_email],
    ["[[TENANT_NAME_SIG]]", tenantSigName],
    ["[[TENANT_EMAIL_SIG]]", tenantSigEmail],
    ["[[PROVIDER_NAME]]", d.provider_name],
    ["[[PROVIDER_EMAIL]]", d.provider_email],
    ["[[PREMISES_ADDRESS]]", d.premises_address],
    ["[[MONTHLY_RENT]]", d.monthly_rent],
    ["[[WEEKLY_RENT]]", d.weekly_rent],
    ["[[BOND_AMOUNT]]", d.bond_amount],
    ["[[BOND_PAYMENT_DUE]]", d.bond_payment_due],
    ["[[Date_BondPayment]]", d.bond_payment_due],
    ["[[COMMENCEMENT_DATE]]", d.commencement_date],
    ["[[TERMINATE_DATE]]", d.terminate_date],
    ["[[SIGNED_DATETIME]]", d.signed_datetime],
    ["[[DOCUMENT_ID]]", d.document_id],
    ["[[AUDIT_SENT_TENANT]]", d.audit_sent_tenant],
    ["[[AUDIT_SENT_PROVIDER]]", d.audit_sent_provider],
    ["[[AUDIT_VIEWED]]", d.audit_viewed],
    ["[[AUDIT_VERIFIED]]", d.audit_verified],
    ["[[AUDIT_SIGNED]]", d.audit_signed],
    ["[[AUDIT_FINALIZED]]", d.audit_finalized],
  ];

  for (const [needle, value] of pairs) {
    out = replaceAll(out, needle, value);
  }

  out = replacePlaceholderParagraph(out, "[[TENANT_NAME]]", d.tenant_name, { boldLeadLines: false });
  out = replaceFirstPlaceholderParagraph(out, "[[TENANT_EMAIL]]", d.tenant_email);
  out = replaceFirstPlaceholderParagraph(out, "[[TENANT_EMAIL]]", tenantEmailConsent);

  out = replacePlaceholderParagraph(out, "[[CORE_SECTIONS]]", d.core_sections, { boldLeadLines: true });
  out = replacePlaceholderParagraph(out, "[[ADDITIONAL_TERMS]]", d.additional_terms, { boldLeadLines: true });
  out = replacePlaceholderParagraph(out, "[[ADDITIONAL_SHARE_HOUSE_RULES]]", d.additional_share_house_rules, {
    boldLeadLines: false,
  });

  return { xml: out, data: d };
}

async function resolveTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "lib", "shm", "templates", "tenant-agreement-template.docx"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "tenant-agreement-template.docx"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error("Tenant agreement template file is missing on the server.");
}

export async function generateTenantAgreementDocx(
  data: Record<string, unknown>,
  options?: {
    tenantSignature?: string;
    providerSignature?: string;
    documentId?: string;
    signedAt?: Date;
    signers?: Parameters<typeof buildTenantAgreementTemplateData>[1]["signers"];
  },
) {
  const templatePath = await resolveTemplatePath();
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Tenant agreement template is missing document.xml.");
  }

  const tenantInfo = getSignatureInfo(options?.tenantSignature);
  const providerInfo = getSignatureInfo(options?.providerSignature);

  const { xml: filledFields, data: d } = applyTemplatePlaceholders(documentFile.asText(), data, {
    documentId: options?.documentId,
    signedAt: options?.signedAt,
    signers: options?.signers,
  });

  // Rebuild ack/signatures/audit as visible paragraphs (fixes orphaned table rows).
  const rebuilt = rebuildSignatureAndAuditSection(filledFields, d, {
    tenantRelId: tenantInfo ? "rIdTaTenantSig" : undefined,
    providerRelId: providerInfo ? "rIdTaProviderSig" : undefined,
  });
  zip.file("word/document.xml", rebuilt);

  const relsFile = zip.file("word/_rels/document.xml.rels");
  let relsXml = relsFile ? relsFile.asText() : "";

  // Keep legacy media slots in sync AND add dedicated signature media for new drawings.
  if (tenantInfo) {
    zip.file("word/media/image2.png", tenantInfo.buffer);
    const fileName = `tenant-signature.${tenantInfo.ext}`;
    zip.file(`word/media/${fileName}`, tenantInfo.buffer);
    addImageContentTypeIfNeeded(zip, tenantInfo.ext);
    if (relsXml && !relsXml.includes('Id="rIdTaTenantSig"')) {
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="rIdTaTenantSig" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/></Relationships>`,
      );
    }
  }
  if (providerInfo) {
    zip.file("word/media/image3.png", providerInfo.buffer);
    const fileName = `provider-signature.${providerInfo.ext}`;
    zip.file(`word/media/${fileName}`, providerInfo.buffer);
    addImageContentTypeIfNeeded(zip, providerInfo.ext);
    if (relsXml && !relsXml.includes('Id="rIdTaProviderSig"')) {
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="rIdTaProviderSig" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/></Relationships>`,
      );
    }
  }
  if (relsFile && relsXml) {
    zip.file("word/_rels/document.xml.rels", relsXml);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
