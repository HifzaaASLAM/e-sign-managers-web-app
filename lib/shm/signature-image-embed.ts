/** EMUs per pixel at 96 dpi (914400 / 96). */
const EMU_PER_PX = 9525;

const DEFAULT_MAX_CX = 3_200_000;
const DEFAULT_MAX_CY = 1_100_000;

export function readPngPixelSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

export function readJpegPixelSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width && height) return { width, height };
      return null;
    }
    const segLen = buffer.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}

export function signatureImagePixelSize(buffer: Buffer, ext: string) {
  const normalized = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
  if (normalized === "png") return readPngPixelSize(buffer);
  if (normalized === "jpg") return readJpegPixelSize(buffer);
  return null;
}

/** Word inline extent preserving aspect ratio; image bytes are not modified. */
export function signatureInlineExtentEmu(
  buffer: Buffer,
  ext: string,
  maxCx = DEFAULT_MAX_CX,
  maxCy = DEFAULT_MAX_CY,
) {
  const px = signatureImagePixelSize(buffer, ext);
  if (!px) {
    return { cx: 2_400_000, cy: 800_000 };
  }
  let cx = Math.round(px.width * EMU_PER_PX);
  let cy = Math.round(px.height * EMU_PER_PX);
  const scale = Math.min(maxCx / cx, maxCy / cy, 1);
  if (scale < 1) {
    cx = Math.round(cx * scale);
    cy = Math.round(cy * scale);
  }
  return { cx: Math.max(cx, 1), cy: Math.max(cy, 1) };
}

export function signatureDrawingRunXml(
  relId: string,
  name: string,
  docPrId: number,
  cx: number,
  cy: number,
) {
  const safeName = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${safeName}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${safeName}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r>`
  );
}

export function signatureDrawingRunForImage(
  relId: string,
  name: string,
  docPrId: number,
  buffer: Buffer,
  ext: string,
) {
  const { cx, cy } = signatureInlineExtentEmu(buffer, ext);
  return signatureDrawingRunXml(relId, name, docPrId, cx, cy);
}
