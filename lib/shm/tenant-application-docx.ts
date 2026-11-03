import PizZip from "pizzip";
import { stripDataUri } from "./make";
import { applyTenantApplicationDocxPreviewFixes } from "./tenant-application-docx-preview-fixes";

function xmlEscape(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUrlToFile(dataUrl: string) {
  const str = String(dataUrl || "").trim();
  const match = str.match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,(.+)$/i);
  if (match) {
    const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const rawExt = match[2].toLowerCase();
    const ext = rawExt === "jpeg" || rawExt === "jpg" ? "jpg" : rawExt === "webp" ? "png" : rawExt;
    return {
      bytes: Buffer.from(match[3], "base64"),
      mime: ext === "png" && mime.includes("webp") ? "image/png" : mime,
      ext: ext === "webp" ? "png" : ext,
    };
  }

  const clean = stripDataUri(str);
  if (!clean) return null;
  return { bytes: Buffer.from(clean, "base64"), mime: "image/png", ext: "png" };
}

function nextRelationshipId(relsXml: string) {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function addImageContentTypeIfNeeded(zip: PizZip, ext: string, mime: string) {
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return;
  let ct = ctFile.asText();
  if (ct.includes(`Extension="${ext}"`)) return;
  const node = `<Default Extension="${ext}" ContentType="${mime}"/>`;
  ct = ct.replace("</Types>", `${node}</Types>`);
  zip.file("[Content_Types].xml", ct);
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
    `<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
  );
}

/** CAV bordered rows use ~680 twips (~34pt); keep signatures inside the box. */
const TA_SIGNATURE_WIDTH_PT = 200;
const TA_SIGNATURE_HEIGHT_PT = 26;
const EMU_PER_PT = 9525;

function signatureDrawingRun(relId: string, name: string, docPrId: number) {
  const cx = TA_SIGNATURE_WIDTH_PT * EMU_PER_PT;
  const cy = TA_SIGNATURE_HEIGHT_PT * EMU_PER_PT;
  const safe = xmlEscape(name);
  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${safe}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${safe}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function signatureFieldParagraph(drawingRun: string) {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Textfill"/>` +
    `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${drawingRun}</w:p>`
  );
}

function textFillParagraph(text: string) {
  return `<w:p><w:pPr><w:pStyle w:val="Textfill"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function captionLabelCell(label: string) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="2495" w:type="dxa"/>` +
    `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders>` +
    `<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:pStyle w:val="Caption2"/></w:pPr><w:r><w:t>${xmlEscape(label)}</w:t></w:r></w:p></w:tc>`
  );
}

function borderedValueCell(innerParagraphs: string, rowHeight = 680) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="7938" w:type="dxa"/>` +
    `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders>` +
    `<w:vAlign w:val="center"/></w:tcPr>${innerParagraphs}</w:tc>`
  );
}

function embedSignatureImage(zip: PizZip, dataUrl: string, fileStem: string) {
  const image = dataUrlToFile(dataUrl);
  if (!image) return null;

  const fileName = `${fileStem}.${image.ext}`;
  zip.file(`word/media/${fileName}`, image.bytes);
  addImageContentTypeIfNeeded(zip, image.ext, image.mime);

  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return null;
  let relsXml = relsFile.asText();
  const rId = nextRelationshipId(relsXml);
  const relNode = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`;
  relsXml = relsXml.replace("</Relationships>", `${relNode}</Relationships>`);
  zip.file("word/_rels/document.xml.rels", relsXml);
  return { rId, fileName };
}

function formatDateTimeAU(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Australia/Melbourne",
  }).format(value);
}

function formatDateAU(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Australia/Melbourne",
  }).format(value);
}

const STAMP_START = "SHM_CREATOR_APPROVAL_START";
const STAMP_END = "SHM_CREATOR_APPROVAL_END";
const AGENT_STAMP_START = "SHM_AGENT_SIGNATURE_START";
const AGENT_STAMP_END = "SHM_AGENT_SIGNATURE_END";

function findApplicantDeclarationIndex(xml: string) {
  return xml.indexOf("Applicant\u2019s declaration");
}

function findInsertPointAfterApplicantDateTable(xml: string) {
  const decl = findApplicantDeclarationIndex(xml);
  if (decl === -1) return null;
  let pos = decl;
  let tablesClosed = 0;
  while (pos < xml.length && tablesClosed < 2) {
    const close = xml.indexOf("</w:tbl>", pos);
    if (close === -1) return null;
    tablesClosed += 1;
    if (tablesClosed === 2) return close + "</w:tbl>".length;
    pos = close + 1;
  }
  return null;
}

function removePreviousAgentStamp(xml: string) {
  const startMarker = `<!--${AGENT_STAMP_START}-->`;
  const endMarker = `<!--${AGENT_STAMP_END}-->`;
  if (xml.includes(startMarker) && xml.includes(endMarker)) {
    return xml.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "g"), "");
  }
  return xml;
}

/** Same flow fixes as applicant DOCX build (tenant-application.html). */
function fixTenantApplicationDocxFlow(xml: string) {
  xml = xml.replace(/<w:br\s+w:type="page"\s*\/>/g, "");
  xml = xml
    .replace(/<w:type\s+w:val="nextPage"\s*\/>/g, '<w:type w:val="continuous"/>')
    .replace(/<w:type\s+w:val="nextPage"\s*><\/w:type>/g, '<w:type w:val="continuous"/>');
  xml = xml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (sectionXml) => {
    if (/<w:type\b/.test(sectionXml)) return sectionXml;
    return sectionXml.replace(/<w:sectPr\b([^>]*)>/, '<w:sectPr$1><w:type w:val="continuous"/>');
  });
  xml = xml.replace(
    /<w:p\b[^>]*>\s*<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<\/w:pPr>\s*(?:<w:r\b[^>]*>\s*(?:<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*?<\/w:rPr>)?\s*<\/w:r>\s*)+<\/w:p>/g,
    "",
  );
  return xml;
}

function normalizeTenantApplicationSignatureExtents(xml: string) {
  const cx = TA_SIGNATURE_WIDTH_PT * EMU_PER_PT;
  const cy = TA_SIGNATURE_HEIGHT_PT * EMU_PER_PT;
  return xml
    .replace(/wp:extent cx="\d+" cy="\d+"/g, `wp:extent cx="${cx}" cy="${cy}"`)
    .replace(/<a:ext cx="\d+" cy="\d+"\/>/g, `<a:ext cx="${cx}" cy="${cy}"/>`);
}

/** Drops the forced page break before CAV “Help or further information” (avoids a trailing blank page). */
function removePageBreakBeforeHelpSection(xml: string) {
  const helpIdx = xml.indexOf("Help or further information");
  if (helpIdx < 0) return xml;
  const start = Math.max(0, helpIdx - 4000);
  const region = xml.slice(start, helpIdx);
  const cleaned = region.replace(/<w:br\s+w:type="page"\s*\/>/g, "");
  return xml.slice(0, start) + cleaned + xml.slice(helpIdx);
}

function applicantSignatureRowHasDrawing(xml: string) {
  const decl = findApplicantDeclarationIndex(xml);
  if (decl === -1) return true;
  const label = xml.indexOf("Applicant\u2019s s", decl);
  if (label === -1) return true;
  const rowEnd = xml.indexOf("</w:tr>", label);
  if (rowEnd === -1) return true;
  return xml.slice(label, rowEnd).includes("<w:drawing");
}

function insertApplicantSignatureDrawing(xml: string, drawingRun: string) {
  const runWithPlaceholder = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?\{\{sig_text\}\}(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/;
  if (runWithPlaceholder.test(xml)) {
    return xml.replace(runWithPlaceholder, drawingRun);
  }

  const decl = findApplicantDeclarationIndex(xml);
  if (decl === -1) return xml;
  const label = xml.indexOf("Applicant\u2019s s", decl);
  if (label === -1) return xml;
  const valueCell = xml.indexOf("<w:tc>", xml.indexOf("</w:tc>", label) + 6);
  if (valueCell === -1) return xml;
  const cellClose = xml.indexOf("</w:tc>", valueCell);
  if (cellClose === -1) return xml;
  const cellXml = xml.slice(valueCell, cellClose + "</w:tc>".length);
  const filledCell = cellXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/, signatureFieldParagraph(drawingRun));
  return xml.slice(0, valueCell) + filledCell + xml.slice(cellClose + "</w:tc>".length);
}

function ensureApplicantSignatureEmbedded(
  zip: PizZip,
  xml: string,
  applicantSignatureDataUrl?: string,
): string {
  const dataUrl = String(applicantSignatureDataUrl || "").trim();
  if (!dataUrl.startsWith("data:image/")) return xml;
  if (applicantSignatureRowHasDrawing(xml)) return xml;

  const embedded = embedSignatureImage(zip, dataUrl, "applicant-signature");
  if (!embedded) return xml;
  const run = signatureDrawingRun(embedded.rId, "Applicant Signature", 9501);
  return insertApplicantSignatureDrawing(xml, run);
}

function buildAgentSignatureBlock(input: {
  agentSigRun: string;
  agentName: string;
  approvedDate: string;
}) {
  const tableStart =
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGridLight1"/><w:tblW w:w="10433" w:type="dxa"/>` +
    `<w:tblInd w:w="340" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2495"/><w:gridCol w:w="7938"/></w:tblGrid>`;

  const sigRow =
    `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="680"/></w:trPr>` +
    captionLabelCell("Agent / property manager signature") +
    borderedValueCell(signatureFieldParagraph(input.agentSigRun)) +
    `</w:tr>`;

  const nameRow =
    `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="340"/></w:trPr>` +
    captionLabelCell("Agent name") +
    borderedValueCell(textFillParagraph(input.agentName)) +
    `</w:tr>`;

  const dateRow =
    `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="340"/></w:trPr>` +
    captionLabelCell("Date approved") +
    borderedValueCell(textFillParagraph(input.approvedDate)) +
    `</w:tr>`;

  return (
    `<!--${AGENT_STAMP_START}-->` +
    tableStart +
    sigRow +
    nameRow +
    dateRow +
    `</w:tbl><!--${AGENT_STAMP_END}-->`
  );
}

function removePreviousStamp(xml: string) {
  xml = removePreviousAgentStamp(xml);
  // Prefer marker-based removal; fall back to heading text if markers were stripped.
  const startMarker = `<!--${STAMP_START}-->`;
  const endMarker = `<!--${STAMP_END}-->`;
  if (xml.includes(startMarker) && xml.includes(endMarker)) {
    return xml.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "g"), "");
  }

  const heading = "ShareHouseManagers — Agency / Creator Approval";
  const idx = xml.indexOf(heading);
  if (idx === -1) return xml;
  const pStart = xml.lastIndexOf("<w:p", idx);
  if (pStart === -1 || pStart > idx) return xml;

  // Prefer cutting through the end marker heading block until Audit trail ID paragraph ends,
  // or until the next major section / sectPr.
  const auditId = xml.indexOf("ID: ", idx);
  if (auditId !== -1 && auditId < idx + 20000) {
    const pClose = xml.indexOf("</w:p>", auditId);
    if (pClose !== -1) {
      return xml.slice(0, pStart) + xml.slice(pClose + "</w:p>".length);
    }
  }

  const sect = xml.indexOf("<w:sectPr", idx);
  if (sect !== -1 && sect < idx + 50000) {
    return xml.slice(0, pStart) + xml.slice(sect);
  }

  // Last resort: remove ~40 following paragraphs worth of content by finding a far </w:p>
  let cursor = idx;
  for (let i = 0; i < 40; i += 1) {
    const next = xml.indexOf("</w:p>", cursor);
    if (next === -1) break;
    cursor = next + "</w:p>".length;
  }
  return xml.slice(0, pStart) + xml.slice(cursor);
}

export type TenantApplicationAuditLine = {
  label: string;
  at?: Date | string | null;
  detail?: string;
};

/**
 * Take the applicant-signed Tenant Application DOCX and stamp the agent/creator
 * signature into labelled CAV-style fields after the applicant declaration (no audit trail).
 */
export function stampCreatorSignatureOnTenantApplicationDocx(input: {
  docxBase64: string;
  creatorSignatureDataUrl: string;
  creatorName: string;
  creatorEmail?: string;
  applicantName?: string;
  applicantEmail?: string;
  applicantSignatureDataUrl?: string;
  signedAt?: Date;
  documentId?: string;
  /** @deprecated Audit trail is not written to the final document. */
  auditLines?: TenantApplicationAuditLine[];
}): Buffer {
  const raw = Buffer.from(stripDataUri(input.docxBase64), "base64");
  const zip = new PizZip(raw);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("word/document.xml missing from tenant application DOCX");
  }

  let xml = removePreviousStamp(documentFile.asText());
  xml = ensureApplicantSignatureEmbedded(zip, xml, input.applicantSignatureDataUrl);

  const embedded = embedSignatureImage(zip, input.creatorSignatureDataUrl, "creator-auto-signature");
  if (!embedded) {
    throw new Error("Creator signature image could not be embedded.");
  }

  const signedAt = input.signedAt || new Date();
  const agentName = String(input.creatorName || "ShareHouse Managers").trim();
  const agentSigRun = signatureDrawingRun(embedded.rId, "Agent Signature", 9601);

  const agentBlock = buildAgentSignatureBlock({
    agentSigRun,
    agentName,
    approvedDate: formatDateAU(signedAt),
  });

  const insertAt = findInsertPointAfterApplicantDateTable(xml);
  if (insertAt === null) {
    throw new Error("Could not locate applicant declaration section in Tenant Application DOCX.");
  }

  xml = xml.slice(0, insertAt) + agentBlock + xml.slice(insertAt);
  xml = fixTenantApplicationDocxFlow(xml);
  xml = removePageBreakBeforeHelpSection(xml);
  xml = normalizeTenantApplicationSignatureExtents(xml);
  applyTenantApplicationDocxPreviewFixes(zip, xml);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export function readLastSubmissionDocx(agreementData: Record<string, unknown> | null | undefined) {
  // Prefer the original applicant-signed DOCX when re-stamping so approval blocks stay clean.
  const original = agreementData?.applicant_signed_docx;
  if (original && typeof original === "object") {
    const row = original as Record<string, unknown>;
    const fileContent = String(row.fileContent || "").trim();
    if (fileContent) {
      return {
        fileContent: stripDataUri(fileContent),
        fileName: String(row.fileName || "Tenant-Application.docx"),
        fileType: String(
          row.fileType ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      };
    }
  }

  const submission = agreementData?.last_submission;
  if (!submission || typeof submission !== "object") return null;
  const row = submission as Record<string, unknown>;
  const fileContent = String(row.fileContent || row.docxFileContent || "").trim();
  if (!fileContent) return null;
  const fileName = String(row.fileName || row.docxFileName || "Tenant-Application.docx");
  const fileType = String(
    row.fileType ||
      row.docxFileType ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  return { fileContent: stripDataUri(fileContent), fileName, fileType };
}

export function buildTenantApplicationAuditLines(input: {
  documentId: string;
  sentAt?: Date | string | null;
  applicantName?: string;
  applicantEmail?: string;
  applicantSignedAt?: Date | string | null;
  creatorName?: string;
  creatorEmail?: string;
  creatorSignedAt?: Date | string | null;
  landlordName?: string;
  landlordEmail?: string;
  landlordApprovedAt?: Date | string | null;
  events?: Array<{ eventType: string; eventTime: Date | string; ipAddress?: string | null }>;
}): TenantApplicationAuditLine[] {
  const lines: TenantApplicationAuditLine[] = [];

  lines.push({
    label: "Application sent to applicant",
    at: input.sentAt || undefined,
    detail: input.applicantEmail || undefined,
  });

  if (input.applicantSignedAt) {
    lines.push({
      label: "Applicant signed",
      at: input.applicantSignedAt,
      detail: [input.applicantName, input.applicantEmail].filter(Boolean).join(" / ") || undefined,
    });
  }

  if (input.creatorSignedAt) {
    lines.push({
      label: "Agency / creator approved",
      at: input.creatorSignedAt,
      detail: [input.creatorName, input.creatorEmail].filter(Boolean).join(" / ") || undefined,
    });
  }

  if (input.landlordApprovedAt) {
    lines.push({
      label: "Landlord approved tenant",
      at: input.landlordApprovedAt,
      detail: [input.landlordName, input.landlordEmail].filter(Boolean).join(" / ") || undefined,
    });
  }

  // Append notable system events (dedupe against the structured lines above).
  const seen = new Set(lines.map((l) => l.label.toLowerCase()));
  for (const event of input.events || []) {
    const type = String(event.eventType || "").trim();
    if (!type) continue;
    const friendly = type.replace(/_/g, " ");
    if (seen.has(friendly.toLowerCase())) continue;
    if (
      /signed|approved|sent|viewed|opened|invite|stamp|finalized/i.test(type) &&
      !/email_error|email_skipped|failed/i.test(type)
    ) {
      lines.push({
        label: friendly,
        at: event.eventTime,
        detail: event.ipAddress ? `IP ${event.ipAddress}` : undefined,
      });
      seen.add(friendly.toLowerCase());
    }
  }

  return lines;
}
