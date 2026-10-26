import { mergeDocxRuns } from "./docx-utils";

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainBlockText(blockXml: string) {
  return mergeDocxRuns(blockXml)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setBlockPlainText(blockXml: string, text: string) {
  const escaped = escapeXml(text);
  let replaced = false;
  const withPara = blockXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
    if (replaced) return pXml;
    const next = pXml.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/, (_m, attrs) => {
      replaced = true;
      const space = String(attrs).includes("xml:space") ? "" : ' xml:space="preserve"';
      return `<w:t${attrs}${space}>${escaped}</w:t>`;
    });
    return next;
  });
  if (replaced) return withPara;
  return blockXml.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/, (_m, attrs) => {
    const space = String(attrs).includes("xml:space") ? "" : ' xml:space="preserve"';
    return `<w:t${attrs}${space}>${escaped}</w:t>`;
  });
}

function replaceExactParagraph(xml: string, exact: string, replacement: string) {
  if (!exact) return xml;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
    if (plainBlockText(pXml) !== exact) return pXml;
    return setBlockPlainText(pXml, replacement);
  });
}

function withNote(value: string, note: string) {
  const base = str(value);
  const extra = str(note);
  if (!base) return extra;
  return extra ? `${base} — ${extra}` : base;
}

export type ProfessionalParagraphData = {
  owner: string;
  owner_sign_name: string;
  agent_sign_name: string;
  asbestos: string;
};

/** Clear reference-doc sample answers stored as body paragraphs (not table rows). */
export function applyProfessionalParagraphSampleFill(
  xml: string,
  data: Record<string, unknown>,
  d: ProfessionalParagraphData,
) {
  let out = xml;

  out = replaceExactParagraph(out, "Teams", str(d.owner_sign_name) || str(d.owner));
  out = replaceExactParagraph(out, "DigiTechDev", str(d.agent_sign_name) || "Ishaq M");

  const asbestos = withNote(d.asbestos, str(data.asbestos_note));
  if (asbestos) out = replaceExactParagraph(out, "Unknown", asbestos);

  return out;
}
