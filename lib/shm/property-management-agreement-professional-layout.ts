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
