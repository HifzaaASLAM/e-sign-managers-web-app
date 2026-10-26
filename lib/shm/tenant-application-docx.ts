import PizZip from "pizzip";
import { stripDataUri } from "./make";

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

function signatureDrawingParagraph(relId: string, name: string, docPrId: number) {
  const cx = 2400000;
  const cy = 800000;
  const safe = xmlEscape(name);
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

function removePreviousStamp(xml: string) {
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

/**
 * CAV templates have multiple mid-document <w:sectPr> section breaks.
 * Only the final body-level sectPr (last one before </w:body>) is safe for append.
 */
function insertBeforeFinalBodySectPr(xml: string, block: string) {
  const bodyClose = xml.lastIndexOf("</w:body>");
  if (bodyClose === -1) {
    throw new Error("DOCX body marker missing; cannot stamp creator signature.");
  }
  const sectIdx = xml.lastIndexOf("<w:sectPr", bodyClose);
  if (sectIdx !== -1) {
    return xml.slice(0, sectIdx) + block + xml.slice(sectIdx);
  }
  return xml.slice(0, bodyClose) + block + xml.slice(bodyClose);
}

/**
 * Prefer placing the creator approval block directly under the applicant signature
 * (after "I declare" / "Applicant's signature"), where reviewers actually look.
 */
function findInsertPointAfterApplicantSignature(xml: string): number | null {
  const markers = [
    "Applicant's signature",
    "Applicant’s signature",
    "I declare that the information given on this form is true",
    "I declare that the information",
  ];

  let markerIdx = -1;
  for (const marker of markers) {
    const idx = xml.indexOf(marker);
    if (idx !== -1 && (markerIdx === -1 || idx < markerIdx)) markerIdx = idx;
  }
  if (markerIdx === -1) return null;

  // Search forward for the applicant signature drawing, then end of that paragraph.
  const searchEnd = Math.min(xml.length, markerIdx + 25000);
  const region = xml.slice(markerIdx, searchEnd);
  const drawingRel = region.search(/<w:drawing[\s>]/);
  if (drawingRel !== -1) {
    const absDrawing = markerIdx + drawingRel;
    const pClose = xml.indexOf("</w:p>", absDrawing);
    if (pClose !== -1) return pClose + "</w:p>".length;
  }

  // Fallback: end of the paragraph that contains the marker.
  const pClose = xml.indexOf("</w:p>", markerIdx);
  return pClose !== -1 ? pClose + "</w:p>".length : null;
}

function insertStampBlock(xml: string, block: string) {
  const afterSig = findInsertPointAfterApplicantSignature(xml);
  if (afterSig !== null) {
    return xml.slice(0, afterSig) + block + xml.slice(afterSig);
  }
  return insertBeforeFinalBodySectPr(xml, block);
}

export type TenantApplicationAuditLine = {
  label: string;
  at?: Date | string | null;
  detail?: string;
};

/**
 * Take the applicant-signed Tenant Application DOCX and physically stamp the
 * ShareHouseManagers / creator signature + audit trail into a regenerated final DOCX.
 */
export function stampCreatorSignatureOnTenantApplicationDocx(input: {
  docxBase64: string;
  creatorSignatureDataUrl: string;
  creatorName: string;
  creatorEmail?: string;
  applicantName?: string;
  applicantEmail?: string;
  signedAt?: Date;
  documentId?: string;
  auditLines?: TenantApplicationAuditLine[];
}): Buffer {
  const raw = Buffer.from(stripDataUri(input.docxBase64), "base64");
  const zip = new PizZip(raw);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("word/document.xml missing from tenant application DOCX");
  }

  let xml = removePreviousStamp(documentFile.asText());

  const embedded = embedSignatureImage(zip, input.creatorSignatureDataUrl, "creator-auto-signature");
  if (!embedded) {
    throw new Error("Creator signature image could not be embedded.");
  }

  const signedAt = input.signedAt || new Date();
  const creatorSigPara = signatureDrawingParagraph(embedded.rId, "Creator Signature", 9601);
  const auditLines =
    input.auditLines && input.auditLines.length
      ? input.auditLines
      : [
          {
            label: "Application sent to applicant",
            detail: input.applicantEmail || undefined,
          },
          {
            label: "Applicant signed",
            detail: input.applicantName || undefined,
          },
          {
            label: "Agency / creator approved",
            at: signedAt,
            detail: input.creatorName || undefined,
          },
        ];

  const auditParas = auditLines
    .map((line) => {
      const when = line.at
        ? formatDateTimeAU(line.at instanceof Date ? line.at : new Date(line.at))
        : "";
      const detail = line.detail ? ` — ${line.detail}` : "";
      const whenPart = when ? ` — ${when}` : "";
      return para(`${line.label}${whenPart}${detail}`, { before: 40, after: 40, size: 18 });
    })
    .join("");

  const stamp = [
    `<!--${STAMP_START}-->`,
    para(""),
    para("ShareHouseManagers — Agency / Creator Approval", { bold: true, before: 280, after: 100, size: 24 }),
    para(`Approved by: ${input.creatorName || "ShareHouse Managers"}`, { before: 40, after: 40 }),
    para(`Email: ${input.creatorEmail || "—"}`, { before: 0, after: 40 }),
    para(`Document ID: ${input.documentId || ""}`, { before: 0, after: 40 }),
    para(`Approved on: ${formatDateAU(signedAt)}`, { before: 0, after: 80 }),
    para("Creator / Admin signature", { bold: true, before: 120, after: 40 }),
    creatorSigPara,
    para(""),
    para("Audit trail", { bold: true, before: 200, after: 100, size: 24 }),
    auditParas,
    para(`ID: ${input.documentId || ""}`, { bold: true, before: 80, after: 120 }),
    `<!--${STAMP_END}-->`,
  ].join("");

  xml = insertStampBlock(xml, stamp);
  zip.file("word/document.xml", xml);

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
