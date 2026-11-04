/**
 * Align generated PMA body typography with the 03-11-2026 professional reference.
 * Only touches run font sizes and paragraph line spacing — not text or layout tables.
 */

function normalizeRunFontSize(runXml: string) {
  if (!/<w:rFonts[^>]*w:ascii="Poppins"/.test(runXml)) return runXml;
  if (/SemiBold|Bold|Medium/.test(runXml)) return runXml;
  return runXml
    .replace(/<w:sz w:val="20"\s*\/>/g, '<w:sz w:val="18"/>')
    .replace(/<w:szCs w:val="20"\s*\/>/g, '<w:szCs w:val="18"/>');
}

function normalizeParagraphSpacing(pXml: string) {
  const sp = pXml.match(/<w:spacing([^/]*)\/>/)?.[1] || "";
  // Old shell used 17pt/340 for blocks the reference renders at 12pt/240.
  if (
    sp.includes('w:after="140"') &&
    sp.includes('w:line="340"') &&
    !sp.includes("w:before=")
  ) {
    return pXml.replace(
      /<w:spacing w:after="140" w:line="340" w:lineRule="auto"\/>/,
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
    );
  }
  if (sp.includes('w:after="80"') && sp.includes('w:line="330"')) {
    return pXml.replace(
      /<w:spacing w:after="80" w:line="330" w:lineRule="auto"\/>/,
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
    );
  }
  if (sp.includes('w:after="80"') && sp.includes('w:line="285"')) {
    return pXml.replace(
      /<w:spacing w:after="80" w:line="285" w:lineRule="auto"\/>/,
      '<w:spacing w:after="0" w:line="259" w:lineRule="auto"/>',
    );
  }
  return pXml;
}

export function applyPmaProfessionalTypography(documentXml: string) {
  let out = documentXml.replace(/<w:r\b[\s\S]*?<\/w:r>/g, normalizeRunFontSize);
  out = out.replace(/<w:p\b[\s\S]*?<\/w:p>/g, normalizeParagraphSpacing);
  return out;
}
