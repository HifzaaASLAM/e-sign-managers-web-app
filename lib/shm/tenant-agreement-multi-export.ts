import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PizZip from "pizzip";
import type { TenantSignatureRecord } from "./multi-tenant-signatures";

const PDF_MIME = "application/pdf";

function decodeSignatureImage(dataUrl: string): { bytes: Uint8Array; kind: "png" | "jpg" } | null {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (match) {
    const kind = match[1].toLowerCase() === "png" ? "png" : "jpg";
    return { bytes: Uint8Array.from(Buffer.from(match[2], "base64")), kind };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.length > 40) {
    try {
      return { bytes: Uint8Array.from(Buffer.from(raw, "base64")), kind: "png" };
    } catch {
      return null;
    }
  }
  return null;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function para(text: string, opts?: { bold?: boolean }) {
  const bold = opts?.bold ? "<w:b/><w:bCs/>" : "";
  return (
    `<w:p><w:pPr><w:spacing w:before="80" w:after="60"/></w:pPr>` +
    `<w:r><w:rPr>${bold}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function addImageContentTypeIfNeeded(zip: PizZip, ext: string) {
  const path = "[Content_Types].xml";
  const file = zip.file(path);
  if (!file) return;
  const xml = file.asText();
  const ct =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : `image/${ext}`;
  if (xml.includes(ct)) return;
  zip.file(
    path,
    xml.replace(
      "</Types>",
      `<Default Extension="${ext}" ContentType="${ct}"/></Types>`,
    ),
  );
}

export async function buildMultiTenantSignatureAppendixPdf(input: {
  documentId?: string;
  providerName?: string;
  providerEmail?: string;
  providerSignature?: string;
  tenantSignatures: TenantSignatureRecord[];
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawLine = (text: string, bold = false) => {
    const size = 11;
    if (y < margin + 80) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, {
      x: margin,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.1, 0.15, 0.2),
    });
    y -= size + 6;
  };

  drawLine("Electronic signatures — all tenants", true);
  if (input.documentId) drawLine(`Document: ${input.documentId}`);
  y -= 8;

  if (input.providerSignature) {
    drawLine("Rental provider / creator", true);
    drawLine(`${input.providerName || "Provider"} · ${input.providerEmail || ""}`);
    const img = decodeSignatureImage(input.providerSignature);
    if (img) {
      const embedded =
        img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
      const w = 180;
      const h = (embedded.height / embedded.width) * w;
      if (y - h < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawImage(embedded, { x: margin, y: y - h, width: w, height: h });
      y -= h + 16;
    }
    y -= 12;
  }

  for (const tenant of input.tenantSignatures) {
    drawLine(tenant.name, true);
    drawLine(tenant.email);
    if (tenant.signedAt) {
      try {
        drawLine(`Signed: ${new Date(tenant.signedAt).toLocaleString("en-AU")}`);
      } catch {
        // ignore
      }
    }
    const img = decodeSignatureImage(tenant.signature);
    if (img) {
      const embedded =
        img.kind === "png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
      const w = 180;
      const h = (embedded.height / embedded.width) * w;
      if (y - h < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawImage(embedded, { x: margin, y: y - h, width: w, height: h });
      y -= h + 20;
    } else {
      y -= 8;
    }
    y -= 8;
  }

  return pdf.save();
}

export async function mergePdfBuffers(base: Buffer, appendix: Uint8Array) {
  const merged = await PDFDocument.create();
  const baseDoc = await PDFDocument.load(base);
  const appendixDoc = await PDFDocument.load(appendix);
  const basePages = await merged.copyPages(baseDoc, baseDoc.getPageIndices());
  basePages.forEach((p) => merged.addPage(p));
  const appendixPages = await merged.copyPages(appendixDoc, appendixDoc.getPageIndices());
  appendixPages.forEach((p) => merged.addPage(p));
  const bytes = await merged.save();
  return Buffer.from(bytes);
}

export function appendMultiTenantSignaturesToDocx(
  docxBuffer: Buffer,
  input: {
    providerName?: string;
    providerEmail?: string;
    providerSignature?: string;
    tenantSignatures: TenantSignatureRecord[];
  },
) {
  const zip = new PizZip(docxBuffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return docxBuffer;

  let xml = documentFile.asText();
  const sectIdx = xml.lastIndexOf("<w:sectPr");
  if (sectIdx === -1) return docxBuffer;

  let relsXml = zip.file("word/_rels/document.xml.rels")?.asText() || "";
  let nextRel = 9700;
  let nextDocPr = 9600;
  const blocks: string[] = [
    para(""),
    para("Electronic signatures — all tenants", { bold: true }),
  ];

  function attachImage(dataUrl: string | undefined, label: string) {
    const raw = String(dataUrl || "").trim();
    if (!raw) return;
    const match = raw.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    let ext = "png";
    let buffer: Buffer;
    if (match) {
      ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      buffer = Buffer.from(match[2], "base64");
    } else {
      buffer = Buffer.from(raw, "base64");
    }
    const relId = `rIdMtSig${nextRel}`;
    nextRel += 1;
    const fileName = `multi-tenant-${nextRel}.${ext}`;
    zip.file(`word/media/${fileName}`, buffer);
    addImageContentTypeIfNeeded(zip, ext);
    if (relsXml && !relsXml.includes(`Id="${relId}"`)) {
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/></Relationships>`,
      );
    }
    nextDocPr += 1;
    blocks.push(signatureDrawingParagraph(relId, label, nextDocPr));
  }

  if (input.providerSignature) {
    blocks.push(para(`${input.providerName || "Provider"} · ${input.providerEmail || ""}`, { bold: true }));
    attachImage(input.providerSignature, "Provider signature");
  }

  for (const tenant of input.tenantSignatures) {
    blocks.push(para(`${tenant.name} · ${tenant.email}`, { bold: true }));
    attachImage(tenant.signature, `${tenant.name} signature`);
  }

  xml = `${xml.slice(0, sectIdx)}${blocks.join("")}${xml.slice(sectIdx)}`;
  zip.file("word/document.xml", xml);
  if (relsXml) zip.file("word/_rels/document.xml.rels", relsXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export async function finalizeMultiTenantDocument(input: {
  baseBuffer: Buffer;
  baseMime: string;
  providerName?: string;
  providerEmail?: string;
  providerSignature?: string;
  tenantSignatures: TenantSignatureRecord[];
}) {
  const appendix = await buildMultiTenantSignatureAppendixPdf({
    providerName: input.providerName,
    providerEmail: input.providerEmail,
    providerSignature: input.providerSignature,
    tenantSignatures: input.tenantSignatures,
  });

  if (input.baseMime === PDF_MIME) {
    const merged = await mergePdfBuffers(input.baseBuffer, appendix);
    return { buffer: merged, mimeType: PDF_MIME, isPdf: true, isDocx: false };
  }

  const withSig = appendMultiTenantSignaturesToDocx(input.baseBuffer, {
    providerName: input.providerName,
    providerEmail: input.providerEmail,
    providerSignature: input.providerSignature,
    tenantSignatures: input.tenantSignatures,
  });
  return {
    buffer: withSig,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    isPdf: false,
    isDocx: true,
  };
}
