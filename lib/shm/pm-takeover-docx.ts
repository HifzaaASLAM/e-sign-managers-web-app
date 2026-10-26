import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import { mergeDocxRuns } from "./docx-utils";

export const PM_TAKEOVER_ITEM_COUNT = 31;

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function formatDateAu(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRunPrefix(runOpen: string) {
  const match = runOpen.match(/^(<ns\d+:r\b[^>]*>(?:<ns\d+:rPr>[\s\S]*?<\/ns\d+:rPr>)?)/);
  return match?.[1] || "<ns0:r>";
}

function textRunFromOpen(runOpen: string, text: string) {
  if (!text) return "";
  const runPrefix = extractRunPrefix(runOpen);
  const tOpenMatch = runOpen.match(/<ns\d+:t[^>]*>$/);
  const tOpen = tOpenMatch?.[0] || '<ns0:t xml:space="preserve">';
  const nsPrefix = tOpen.match(/^<(ns\d+):/)?.[1] || "ns0";
  return `${runPrefix}${tOpen}${escapeXml(text)}</${nsPrefix}:t></${nsPrefix}:r>`;
}

function decodeDataUri(dataUri: string) {
  const raw = String(dataUri || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) return Buffer.from(match[2], "base64");
  return Buffer.from(raw, "base64");
}

function getSignatureInfo(dataUrl: string) {
  if (!dataUrl) return null;
  const raw = String(dataUrl).trim();
  const match = raw.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
  if (!match) {
    // Allow raw base64 PNG/JPEG payloads if the data URI prefix was stripped.
    if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s+/g, "").length > 100) {
      return { ext: "png", base64: raw.replace(/\s+/g, "") };
    }
    return null;
  }
  const kind = match[1].toLowerCase();
  const ext = kind === "jpeg" ? "jpg" : kind === "gif" ? "png" : kind === "webp" ? "png" : kind;
  return { ext: ext === "png" || ext === "jpg" ? ext : "png", base64: match[2] };
}

function signatureDrawingRel(ext: string, relId: string) {
  return `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.${ext}"/>`;
}

/**
 * Embed signature with explicit drawing namespaces.
 * This template remaps ns2/ns5 away from wp/r, so hard-coded ns2/ns5 drawings were ignored by Word.
 */
function signatureDrawingRun(relId: string, name: string, docPrId: number) {
  const cx = 2200000;
  const cy = 700000;
  const safeName = escapeXml(name);
  return (
    `<ns0:r><ns0:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${safeName}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${safeName}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline>` +
    `</ns0:drawing></ns0:r>`
  );
}

function insertSignaturePlaceholder(xml: string, placeholder: string, drawingRun: string) {
  const esc = escapeRegExp(placeholder);
  const runPattern = new RegExp(
    `(<ns\\d+:r\\b[^>]*>(?:<ns\\d+:rPr>[\\s\\S]*?<\\/ns\\d+:rPr>)?<ns\\d+:t[^>]*>)([^<]*)${esc}([^<]*)(<\\/ns\\d+:t><\\/ns\\d+:r>)`,
  );
  if (!runPattern.test(xml)) {
    return replaceAll(xml, placeholder, "");
  }
  return xml.replace(runPattern, (_full, runOpen, before, after) => {
    const beforeRun = textRunFromOpen(runOpen, before);
    const afterRun = textRunFromOpen(runOpen, after);
    return `${beforeRun}${drawingRun}${afterRun}`;
  });
}

function applySignaturePlaceholder(
  xml: string,
  placeholder: string,
  dataUrl: string | undefined,
  relId: string,
  mediaName: string,
  docPrId: number,
) {
  if (!dataUrl) return replaceAll(xml, placeholder, "");
  const info = getSignatureInfo(dataUrl);
  if (!info) return replaceAll(xml, placeholder, "Signed electronically");
  const drawingRun = signatureDrawingRun(relId, mediaName, docPrId);
  return insertSignaturePlaceholder(xml, placeholder, drawingRun);
}

function addImageContentTypeIfNeeded(zip: PizZip, ext: string) {
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return;
  let ct = ctFile.asText();
  if (ct.includes(`Extension="${ext}"`)) return;
  const mime = ext === "png"
    ? "image/png"
    : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : "application/octet-stream";
  ct = ct.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
  zip.file("[Content_Types].xml", ct);
}

function markChoice(value: unknown, selected: "Yes" | "No") {
  return str(value) === selected ? "✓" : "";
}

export function buildPmTakeoverTemplateData(data: Record<string, unknown>) {
  const out: Record<string, string> = {
    other_items: str(data.other_items),
    signer_name: str(data.signer_name),
    sign_date: formatDateAu(data.sign_date),
  };

  for (let idx = 0; idx < PM_TAKEOVER_ITEM_COUNT; idx += 1) {
    const value = str(data[`item_${idx}`]);
    out[`item_${idx}_yes`] = markChoice(value, "Yes");
    out[`item_${idx}_no`] = markChoice(value, "No");
  }

  return out;
}

function applyTemplatePlaceholders(
  xml: string,
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const d = buildPmTakeoverTemplateData(data);
  let out = mergeDocxRuns(xml);

  const pairs: Array<[string, string]> = [
    ["[[OTHER_ITEMS]]", d.other_items],
    ["[[SIGNER_NAME]]", d.signer_name],
    ["[[SIGN_DATE]]", d.sign_date],
  ];

  for (let idx = 0; idx < PM_TAKEOVER_ITEM_COUNT; idx += 1) {
    pairs.push([`[[ITEM_${idx}_YES]]`, d[`item_${idx}_yes`]]);
    pairs.push([`[[ITEM_${idx}_NO]]`, d[`item_${idx}_no`]]);
  }

  for (const [needle, value] of pairs) {
    out = replaceAll(out, needle, value);
  }

  out = applySignaturePlaceholder(out, "[[SIGNATURE]]", options?.signature, "rIdPmSig", "Signer Signature", 9201);
  return out;
}

async function resolveTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "lib", "shm", "templates", "pm-takeover-form-template.docx"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "pm-takeover-form-template.docx"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error("PM Takeover Form template file is missing on the server.");
}

export async function generatePmTakeoverDocx(
  data: Record<string, unknown>,
  options?: { signature?: string },
) {
  const templatePath = await resolveTemplatePath();
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("PM Takeover Form template is missing document.xml.");
  }

  const xml = documentFile.asText();
  const filled = applyTemplatePlaceholders(xml, data, options);
  zip.file("word/document.xml", filled);

  const relsFile = zip.file("word/_rels/document.xml.rels");
  let relsXml = relsFile ? relsFile.asText() : "";
  const mediaEntries: Array<{ relId: string; ext: string; buffer: Buffer }> = [];

  if (options?.signature) {
    const info = getSignatureInfo(options.signature);
    if (info) {
      mediaEntries.push({ relId: "rIdPmSig", ext: info.ext, buffer: decodeDataUri(options.signature) });
      if (!relsXml.includes('Id="rIdPmSig"')) {
        relsXml = relsXml.replace(
          "</Relationships>",
          `${signatureDrawingRel(info.ext, "rIdPmSig")}</Relationships>`,
        );
      }
    }
  }

  for (const entry of mediaEntries) {
    zip.file(`word/media/signature.${entry.ext}`, entry.buffer);
    addImageContentTypeIfNeeded(zip, entry.ext);
  }
  if (relsFile && mediaEntries.length > 0) {
    zip.file("word/_rels/document.xml.rels", relsXml);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
