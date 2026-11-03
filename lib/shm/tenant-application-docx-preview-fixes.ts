import type PizZip from "pizzip";

/** CAV Tenant Application page count after flow fixes (footer "Page X of Y"). */
export function resolveTenantApplicationPageCount() {
  const n = Number(process.env.TENANT_APPLICATION_CAV_PAGE_COUNT || "8");
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 8;
}

/** Gmail / Google Docs preview — drop stale Word pagination hints that inflate page count. */
export function fixTenantApplicationDocxGooglePreviewXml(xml: string) {
  xml = xml.replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
  xml = xml.replace(/<w:pageBreakBefore\b[^>]*\/>/g, "");
  return xml;
}

/** Tighter lines in CAV value cells — reduces overlap in Google DOCX preview. */
export function tightenTenantApplicationTextfillParagraphSpacing(xml: string) {
  return xml.replace(
    /(<w:pPr>)([\s\S]*?<w:pStyle w:val="Textfill"[\s\S]*?)(<\/w:pPr>)/g,
    (_match, open: string, mid: string, close: string) => {
      let inner = mid.replace(/<w:spacing\b[^>]*\/>/g, "");
      inner += '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
      return open + inner + close;
    },
  );
}

export function fixTenantApplicationFooterPageCountZip(zip: PizZip, totalPages?: number) {
  const totalStr = String(totalPages ?? resolveTenantApplicationPageCount());
  for (const path of Object.keys(zip.files)) {
    if (!path.startsWith("word/footer") || !path.endsWith(".xml")) continue;
    const file = zip.file(path);
    if (!file) continue;
    let xml = file.asText();
    if (!/NUMPAGES|Page /i.test(xml)) continue;

    xml = xml.replace(
      /(<w:fldSimple w:instr="NUMPAGES[^"]*">[\s\S]*?<w:t>)(\d+)(<\/w:t>[\s\S]*?<\/w:fldSimple>)/g,
      `$1${totalStr}$3`,
    );
    xml = xml.replace(
      /(<w:instrText[^>]*>[\s\S]*?NUMPAGES[\s\S]*?<\/w:instrText>[\s\S]*?<w:fldChar w:fldCharType="separate"\/>[\s\S]*?<w:t>)(\d+)(<\/w:t>)/gi,
      `$1${totalStr}$3`,
    );
    zip.file(path, xml);
  }
}

export function ensureWordUpdatesFieldsOnOpenZip(zip: PizZip) {
  const settingsFile = zip.file("word/settings.xml");
  if (!settingsFile) return;
  let settingsXml = settingsFile.asText();
  if (settingsXml.includes("w:updateFields")) {
    settingsXml = settingsXml.replace(/<w:updateFields w:val="[^"]*"\/>/, '<w:updateFields w:val="true"/>');
  } else {
    settingsXml = settingsXml.replace("</w:settings>", '<w:updateFields w:val="true"/></w:settings>');
  }
  zip.file("word/settings.xml", settingsXml);
}

export function applyTenantApplicationDocxPreviewFixes(zip: PizZip, documentXml: string) {
  let xml = fixTenantApplicationDocxGooglePreviewXml(documentXml);
  xml = tightenTenantApplicationTextfillParagraphSpacing(xml);
  zip.file("word/document.xml", xml);
  fixTenantApplicationFooterPageCountZip(zip);
  ensureWordUpdatesFieldsOnOpenZip(zip);
}
