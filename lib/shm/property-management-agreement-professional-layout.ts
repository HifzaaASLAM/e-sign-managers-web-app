function findTblOpenBefore(xml: string, beforeIndex: number) {
  let p = beforeIndex;
  while (p > 0) {
    const idx = xml.lastIndexOf("<w:tbl", p);
    if (idx < 0) return -1;
    const next = xml[idx + 5];
    if (next === ">" || next === " ") return idx;
    p = idx - 1;
  }
  return -1;
}

function findTblOpenAfter(xml: string, from: number) {
  let p = from;
  while (p < xml.length) {
    const idx = xml.indexOf("<w:tbl", p);
    if (idx < 0) return -1;
    const next = xml[idx + 5];
    if (next === ">" || next === " ") return idx;
    p = idx + 5;
  }
  return -1;
}

function findTableEnd(xml: string, tblStart: number) {
  const afterOpen = xml.indexOf(">", tblStart);
  if (afterOpen < 0) return -1;
  let depth = 1;
  let p = afterOpen + 1;
  while (p < xml.length && depth > 0) {
    const nextOpen = findTblOpenAfter(xml, p);
    const nextClose = xml.indexOf("</w:tbl>", p);
    if (nextClose < 0) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      p = nextOpen + 5;
    } else {
      depth -= 1;
      p = nextClose + "</w:tbl>".length;
    }
  }
  return p;
}

function outerTableBoundsContaining(xml: string, textIdx: number) {
  let outerStart = findTblOpenBefore(xml, textIdx);
  if (outerStart < 0) return null;
  let probe = outerStart - 1;
  while (probe > 0) {
    const prev = findTblOpenBefore(xml, probe);
    if (prev < 0) break;
    const closeAfterPrev = xml.indexOf("</w:tbl>", prev);
    if (closeAfterPrev > textIdx) {
      outerStart = prev;
      probe = prev - 1;
    } else break;
  }
  const outerEnd = findTableEnd(xml, outerStart);
  if (outerEnd < 0) return null;
  return { start: outerStart, end: outerEnd };
}

/** True open tags only — `lastIndexOf("<w:tr")` also hits `<w:trPr>`; `"<w:p"` hits `<w:pPr>` / `<w:pStyle>`. */
function isWordElementOpenAt(xml: string, idx: number, localName: string) {
  const token = `<w:${localName}`;
  if (!xml.startsWith(token, idx)) return false;
  const next = xml[idx + token.length];
  return next === ">" || next === " " || next === "/";
}

function findWordElementOpenBefore(xml: string, beforeIndex: number, localName: string) {
  const token = `<w:${localName}`;
  let p = beforeIndex;
  while (p > 0) {
    const idx = xml.lastIndexOf(token, p);
    if (idx < 0) return -1;
    if (isWordElementOpenAt(xml, idx, localName)) return idx;
    p = idx - 1;
  }
  return -1;
}

function removeParagraphContaining(xml: string, needle: string) {
  const idx = xml.lastIndexOf(needle);
  if (idx < 0) return xml;
  const pStart = findWordElementOpenBefore(xml, idx, "p");
  const pEnd = xml.indexOf("</w:p>", idx);
  if (pStart < 0 || pEnd < 0) return xml;
  return xml.slice(0, pStart) + xml.slice(pEnd + "</w:p>".length);
}

/** Remove the innermost `<w:tr>` that contains `textIdx` (avoids greedy row regex over nested tables). */
function removeInnermostTableRowContaining(xml: string, textIdx: number) {
  const trStart = findWordElementOpenBefore(xml, textIdx, "tr");
  if (trStart < 0) return xml;
  const trEnd = xml.indexOf("</w:tr>", textIdx);
  if (trEnd < 0) return xml;
  return xml.slice(0, trStart) + xml.slice(trEnd + "</w:tr>".length);
}

function removePmaAuditTrailHeaderRow(xml: string) {
  const submitPos = xml.lastIndexOf("Submitted electronically");
  const searchBefore = submitPos > 0 ? submitPos : xml.length;
  let probe = searchBefore;
  while (probe > 0) {
    const trailIdx = xml.lastIndexOf("Trail", probe);
    if (trailIdx < 0) return xml;
    const trStart = findWordElementOpenBefore(xml, trailIdx, "tr");
    const trEnd = xml.indexOf("</w:tr>", trailIdx);
    if (trStart < 0 || trEnd < 0) return xml;
    const rowXml = xml.slice(trStart, trEnd + "</w:tr>".length);
    const plain = rowXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/Audit\s*Trail/i.test(plain) && rowXml.includes("17365D")) {
      return xml.slice(0, trStart) + xml.slice(trEnd + "</w:tr>".length);
    }
    probe = trailIdx - 1;
  }
  return xml;
}

/** Remove Audit Trail header + submitted timestamp block from emailed final DOCX. */
export function stripPmaProfessionalAuditTrail(documentXml: string) {
  let out = removePmaAuditTrailHeaderRow(documentXml);

  const submitIdx = out.lastIndexOf("Submitted electronically");
  if (submitIdx >= 0) {
    out = removeInnermostTableRowContaining(out, submitIdx);
    if (out.includes("Submitted electronically")) {
      out = removeParagraphContaining(out, "Submitted electronically");
    }
  }

  return out;
}

/** Reduce blank pages from Word export artifacts (hard breaks before major sections). */
export function compactPmaProfessionalDocumentLayout(documentXml: string) {
  let out = documentXml;
  out = out.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
  out = out.replace(/<w:pageBreakBefore(?:\s[^/>]*)?\/>/g, "");
  out = out.replace(/<w:pageBreakBefore\s*\/>/g, "");
  out = trimPmaProfessionalDocumentEnd(out);
  return out;
}

/** Contact banner after signatures: drop spacer paragraphs and use inline drawing so it stays on the signatures page. */
export function trimPmaProfessionalDocumentEnd(documentXml: string) {
  const marker = "Submitted electronically:";
  const idx = documentXml.indexOf(marker);
  if (idx < 0) return documentXml;

  const afterSubmitted = documentXml.indexOf("</w:p>", idx);
  if (afterSubmitted < 0) return documentXml;
  const afterSubmittedEnd = afterSubmitted + "</w:p>".length;

  const sectIdx = documentXml.indexOf("<w:sectPr", afterSubmittedEnd);
  if (sectIdx < 0) return documentXml;

  const tail = documentXml.slice(afterSubmittedEnd, sectIdx);
  const drawingParaMatch = tail.match(/<w:p\b[\s\S]*?<w:drawing[\s\S]*?<\/w:p>/);
  const replacement = drawingParaMatch ? inlineContactFooterDrawing(drawingParaMatch[0]) : "";

  return documentXml.slice(0, afterSubmittedEnd) + replacement + documentXml.slice(sectIdx);
}

function inlineContactFooterDrawing(paragraphXml: string) {
  const inlineMatch = paragraphXml.match(/<wp:inline\b[\s\S]*?<\/wp:inline>/);
  if (!inlineMatch) return "";

  const inlineInner = inlineMatch[0]
    .replace(/^<wp:inline\b[^>]*>/, "")
    .replace(/<\/wp:inline>\s*$/, "");

  return (
    `<w:p><w:pPr><w:spacing w:before="240" w:after="80"/><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    inlineInner +
    `</wp:inline></w:drawing></w:r></w:p>`
  );
}

/** Strip cached PAGE / NUMPAGES field text (e.g. stale "2") so Word and PDF exporters recalculate page totals. */
export function refreshWordPageFieldResults(xml: string) {
  let out = xml;
  for (const field of ["PAGE", "NUMPAGES"]) {
    const re = new RegExp(
      `(<w:instrText>${field}</w:instrText></w:r>)([\\s\\S]*?)(<w:fldChar w:fldCharType="end"/>)`,
      "g",
    );
    out = out.replace(re, (_full, afterInstr: string, middle: string, endFld: string) => {
      const cleaned = middle.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (run) => {
        if (run.includes("fldChar")) return run;
        if (/<w:t[^>]*>/.test(run)) return "";
        return run;
      });
      return afterInstr + cleaned + endFld;
    });
  }
  return out;
}

export function ensureWordUpdateFieldsOnOpen(settingsXml: string) {
  if (settingsXml.includes("w:updateFields")) {
    return settingsXml.replace(/<w:updateFields w:val="[^"]*"\/>/, '<w:updateFields w:val="true"/>');
  }
  return settingsXml.replace("</w:settings>", '<w:updateFields w:val="true"/></w:settings>');
}
