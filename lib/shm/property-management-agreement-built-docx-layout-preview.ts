import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { buildPropertyManagementAgreementTemplateData } from "./property-management-agreement-docx";
import {
  PMA_FEE_SCHEDULE,
  PMA_LEGISLATION_NOTE,
  PMA_PRIVACY_PARAGRAPHS,
  PMA_TERMS_SECTIONS,
} from "./property-management-agreement-content";

const TABLE_WIDTH = 9360;
const COL_HALF = 4680;

/** Layout preview only — legal-document styling (Calibri, neutral grayscale). */
const FONT = "Calibri";
const INK = "000000";
const MUTED = "595959";
const LABEL_BG = "F2F2F2";
const SECTION_BG = "F2F2F2";
const SECTION_TITLE = "000000";
const ACCENT = "000000";
const LINE = "D9D9D9";
const LINE_STRONG = "BFBFBF";

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function display(value: unknown) {
  const text = str(value);
  return text || "—";
}

function yn(value: unknown) {
  const text = str(value);
  if (!text || text === "—") return "—";
  if (/^yes$/i.test(text)) return "Yes";
  if (/^no$/i.test(text)) return "No";
  return text;
}

function escapeXml(value: string) {
  const sanitized = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function p(
  text: string,
  opts: { bold?: boolean; color?: string; size?: string; align?: string; after?: string } = {},
) {
  if (!text) {
    return `<w:p><w:pPr><w:spacing w:after="${opts.after || "120"}"/></w:pPr></w:p>`;
  }
  const bold = opts.bold ? "<w:b/>" : "";
  const color = opts.color || "000000";
  const size = opts.size || "20";
  const after = opts.after || "100";
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : "";
  return `<w:p><w:pPr>${align}<w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function h(text: string) {
  return p(text, { bold: true, color: INK, size: "24", after: "140" });
}

function h2(text: string) {
  return p(text, { bold: true, color: INK, size: "20", after: "80" });
}

function termsTitle(text: string) {
  return p(text, { bold: true, color: INK, size: "20", after: "80" });
}

function feeSectionHeading(text: string) {
  return p(text, { bold: true, color: INK, size: "20", after: "60" });
}

function headerDocRule() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LINE_STRONG}"/></w:pBdr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:p>`;
}

function bullet(text: string) {
  return `<w:p><w:pPr><w:ind w:left="360" w:hanging="180"/><w:spacing w:after="60" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${INK}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">• ${escapeXml(text)}</w:t></w:r></w:p>`;
}

function cell(
  text: string,
  opts: {
    width?: number;
    shade?: string;
    bold?: boolean;
    span?: number;
    color?: string;
    size?: string;
  } = {},
) {
  const width = opts.width ? `<w:tcW w:w="${opts.width}" w:type="dxa"/>` : "";
  const shade = opts.shade
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>`
    : "";
  const span = opts.span ? `<w:gridSpan w:val="${opts.span}"/>` : "";
  const bold = opts.bold ? "<w:b/>" : "";
  const color = opts.color || INK;
  const size = opts.size || "19";
  const padding =
    '<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>';
  return `<w:tc><w:tcPr>${width}${shade}${span}${padding}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
}

function row(cells: string) {
  return `<w:tr>${cells}</w:tr>`;
}

function table(rows: string) {
  return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${LINE_STRONG}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${LINE_STRONG}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${LINE_STRONG}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${LINE_STRONG}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${COL_HALF}"/><w:gridCol w:w="${COL_HALF}"/></w:tblGrid>${rows}</w:tbl>`;
}

function stackedCell(label: string, value: unknown, opts: { span?: number } = {}) {
  const span = opts.span ?? 1;
  const width = span === 2 ? TABLE_WIDTH : COL_HALF;
  const spanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
  const padding =
    '<w:tcMar><w:top w:w="110" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar>';
  const labelP = `<w:p><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r></w:p>`;
  const valueP = `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${INK}"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(display(value))}</w:t></w:r></w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${spanXml}${padding}<w:vAlign w:val="top"/></w:tcPr>${labelP}${valueP}</w:tc>`;
}

function pageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function fieldRow(label: string, value: unknown) {
  return row(stackedCell(label, value, { span: 2 }));
}

function fieldRow4(l1: string, v1: unknown, l2: string, v2: unknown) {
  return row(stackedCell(l1, v1) + stackedCell(l2, v2));
}

function sectionRow(title: string, opts: { sub?: boolean } = {}) {
  const bg = opts.sub ? LABEL_BG : SECTION_BG;
  const color = opts.sub ? INK : SECTION_TITLE;
  return row(
    cell(title, {
      bold: true,
      shade: bg,
      span: 2,
      width: TABLE_WIDTH,
      color,
      size: "20",
    }),
  );
}

function complianceRow(question: string, value: unknown, note: string) {
  return fieldRow(question, withNote(display(value), note));
}

function getSignatureInfo(dataUrl: string) {
  if (!dataUrl || !String(dataUrl).startsWith("data:image/")) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  return { ext, base64: match[2] };
}

function decodeDataUri(dataUri: string) {
  const raw = String(dataUri || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) return Buffer.from(match[2], "base64");
  return Buffer.from(raw, "base64");
}

function signatureDrawingRel(ext: string, relId: string) {
  return `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${relId}.${ext}"/>`;
}

function signatureDrawing(ext: string, relId: string, name: string, docPrId: number) {
  const cx = 2400000;
  const cy = 780000;
  return `<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${escapeXml(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function addImageContentTypeIfNeeded(zip: PizZip, ext: string) {
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) return;
  let ct = ctFile.asText();
  if (ct.includes(`Extension="${ext}"`)) return;
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "application/octet-stream";
  ct = ct.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
  zip.file("[Content_Types].xml", ct);
}

function stackedSignatureFieldCell(
  label: string,
  sig: { ext: string; relId: string; drawingName: string; docPrId: number } | null,
) {
  const padding =
    '<w:tcMar><w:top w:w="110" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar>';
  const labelP = `<w:p><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:color w:val="${MUTED}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r></w:p>`;
  const body = sig
    ? signatureDrawing(sig.ext, sig.relId, sig.drawingName, sig.docPrId)
    : `<w:p><w:pPr><w:spacing w:after="0"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${LINE_STRONG}"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${COL_HALF}" w:type="dxa"/>${padding}<w:vAlign w:val="bottom"/></w:tcPr>${labelP}${body}</w:tc>`;
}

function withNote(value: string, note: string) {
  if (!value || value === "—") return note ? `— — ${note}` : "—";
  return note ? `${value} — ${note}` : value;
}

function pmaField(data: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = str(data[key]);
    if (value) return value;
  }
  return fallback;
}

function renderTerms(data: Record<string, unknown>) {
  const dutyDefault =
    PMA_TERMS_SECTIONS.find((s) => s.title.includes("DUTIES"))?.bullets?.join("\n") || "";
  const duties = pmaField(data, ["term_duties", "pma_term_duties"], dutyDefault);
  const dutyBullets = duties
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => bullet(line))
    .join("");

  const sectionOverrides: Record<string, string> = {
    "APPOINTMENT OF AGENT": pmaField(
      data,
      ["term_appointment", "pma_term_appointment"],
      PMA_TERMS_SECTIONS[0]?.paragraphs.join("\n") || "",
    ),
    "MANAGEMENT FEES": pmaField(
      data,
      ["term_management_fees", "pma_term_management_fees"],
      PMA_TERMS_SECTIONS[1]?.paragraphs.join("\n") || "",
    ),
    "TERMINATION OF AGREEMENT": pmaField(
      data,
      ["term_termination", "pma_term_termination"],
      PMA_TERMS_SECTIONS[2]?.paragraphs.join("\n") || "",
    ),
    KEYS: pmaField(data, ["term_keys", "pma_term_keys"], PMA_TERMS_SECTIONS[3]?.paragraphs.join("\n") || ""),
    INSURANCE: pmaField(
      data,
      ["term_insurance", "pma_term_insurance"],
      PMA_TERMS_SECTIONS[4]?.paragraphs.join("\n") || "",
    ),
    "DUTIES OF AGENT": "",
    RENT: PMA_TERMS_SECTIONS.find((s) => s.title === "RENT")?.paragraphs.join("\n") || "",
    EXPENDITURE: pmaField(
      data,
      ["term_expenditure", "pma_term_expenditure"],
      PMA_TERMS_SECTIONS.find((s) => s.title === "EXPENDITURE")?.paragraphs.join("\n") || "",
    ),
  };

  return PMA_TERMS_SECTIONS.map((section) => {
    let block = termsTitle(section.title);
    if (section.title === "DUTIES OF AGENT") {
      for (const para of section.paragraphs) block += p(para);
      block += dutyBullets;
      return block;
    }
    const override = sectionOverrides[section.title];
    const paragraphs = override
      ? override.split(/\n+/).filter(Boolean)
      : section.paragraphs;
    for (const para of paragraphs) block += p(para);
    if (section.bullets && section.title !== "DUTIES OF AGENT") {
      block += section.bullets.map((line) => bullet(line)).join("");
    }
    return block;
  }).join("");
}

function renderPrivacy(data: Record<string, unknown>) {
  const custom = pmaField(data, ["term_privacy", "pma_term_privacy"], "");
  const paragraphs = custom
    ? custom.split(/\n+/).filter(Boolean)
    : PMA_PRIVACY_PARAGRAPHS;
  return [h("Privacy Act 1988 Collection Notice"), ...paragraphs.map((para) => p(para))].join("");
}

function renderFees(data: Record<string, unknown>) {
  const parts = [
    p("LETTING AND MANAGEMENT SCHEDULE OF FEES", { bold: true, color: INK, size: "24", after: "140" }),
    feeSectionHeading("1. Initial letting fee"),
    bullet(
      pmaField(
        data,
        ["fee_initial_letting", "pma_fee_initial_letting"],
        PMA_FEE_SCHEDULE[0]?.lines[0] || "Equal to 0 weeks rent",
      ),
    ),
  ];

  for (const line of PMA_FEE_SCHEDULE[0]?.lines.slice(1) || []) {
    parts.push(bullet(line));
  }

  for (const block of PMA_FEE_SCHEDULE.slice(1)) {
    if (block.heading) parts.push(feeSectionHeading(block.heading));
    for (const line of block.lines) {
      if (/^N\.B\./i.test(line)) {
        parts.push(
          p(`N.B. ${pmaField(data, ["fee_gst", "pma_fee_gst"], line.replace(/^N\.B\.?\s*/i, ""))}`, {
            bold: true,
          }),
        );
      } else if (/^3\.\s*Management fee/i.test(line)) {
        parts.push(
          bullet(`3. Management fee ${pmaField(data, ["fee_management", "pma_fee_management"], "10%")}`),
        );
      } else if (/^2\./.test(line)) {
        parts.push(
          bullet(
            `2. /Renegotiation to secure existing tenants to a new lease ${pmaField(data, ["fee_renegotiation", "pma_fee_renegotiation"], "0 % of a week’s rent")}`,
          ),
        );
      } else if (/^4\./.test(line)) {
        parts.push(
          bullet(
            `4. Monthly Statement and accounting fee ${pmaField(data, ["fee_monthly_statement", "pma_fee_monthly_statement"], "n/a")}`,
          ),
        );
      } else if (block.heading?.includes("tribunal")) {
        const tribunal = pmaField(data, ["fee_tribunal", "pma_fee_tribunal"], line);
        parts.push(bullet(tribunal));
      } else {
        parts.push(bullet(line));
      }
    }
  }

  return parts.join("");
}

function buildSignaturesTable(
  d: ReturnType<typeof buildPropertyManagementAgreementTemplateData>,
  ownerSig: ReturnType<typeof getSignatureInfo>,
  agentSig: ReturnType<typeof getSignatureInfo>,
  includeAgent: boolean,
) {
  const ownerSigMeta = ownerSig
    ? { ext: ownerSig.ext, relId: "rIdOwnerSig", drawingName: "Owner Signature", docPrId: 9101 }
    : null;
  const agentSigMeta =
    includeAgent && agentSig
      ? { ext: agentSig.ext, relId: "rIdAgentSig", drawingName: "Agent Signature", docPrId: 9102 }
      : null;

  const agentNameCell = includeAgent
    ? stackedCell("AGENT (sign) name", d.agent_sign_name || "Ishaq M")
    : stackedCell("AGENT (sign) name", "—");
  const agentDateCell = includeAgent
    ? stackedCell("AGENT date", d.agent_sig_date)
    : stackedCell("AGENT date", "—");

  return [
    row(stackedCell("OWNER (sign) name", d.owner_sign_name) + agentNameCell),
    row(
      stackedSignatureFieldCell("OWNER (sign)", ownerSigMeta)
        + (includeAgent
          ? stackedSignatureFieldCell("AGENT (sign)", agentSigMeta)
          : stackedCell("AGENT (sign)", "—")),
    ),
    row(stackedCell("OWNER date", d.sig_date) + agentDateCell),
  ].join("");
}

export async function generatePropertyManagementAgreementBuiltDocxLayoutPreview(
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  const d = buildPropertyManagementAgreementTemplateData(data);
  const ownerSig = getSignatureInfo(options?.ownerSignature || str(data.signature));
  const agentSig = getSignatureInfo(options?.agentSignature || str(data.agent_signature));

  const rowsPropertyDetails = [
    sectionRow("PROPERTY DETAILS"),
    fieldRow4("Available from", d.available_from, "Available to", d.available_to),
    fieldRow("Property to be managed", d.property),
    fieldRow4("Block", d.block, "Section", d.section),
    fieldRow4("Division", d.division, "EER", d.eer),
    fieldRow4("Unit plan no.", d.unit_plan_no, "Unit plan manager", d.unit_plan_manager),
    fieldRow4("Unit plan phone", d.unit_phone, "Fax", d.fax),
    fieldRow("Property description", d.description),
    fieldRow("Property type", d.property_type),
    fieldRow4("Heating", d.heating, "Hot water", d.hot_water),
    fieldRow4("Dishwasher", d.dishwasher, "Oven", d.oven),
    fieldRow4("Cooktop", d.cooktop, "Warranties", d.warranties),
    fieldRow4("Rent (PW)", d.rent_pw, "At commencement", d.commencement),
    fieldRow4("Preferred lease term", d.lease_term, "Keys supplied (refer to clause 4.)", d.keys),
    sectionRow("OWNER DETAILS"),
    fieldRow("Owner (lessor/s)", d.owner),
    fieldRow("Postal address", d.postal_address),
    fieldRow4("Phone (A.H.)", d.phone_ah, "Phone (B.H.)", d.phone_bh),
    fieldRow4("Mobile", d.mobile, "Email", d.email),
  ].join("");

  const rowsSpecificInstructions = [
    sectionRow("SPECIFIC INSTRUCTIONS"),
    fieldRow("Payment of monies (refer clause 6.c i)", "See deposit details below"),
    fieldRow("Deposit to credit of", d.deposit_to),
    fieldRow4("Bank", d.bank, "Branch", d.branch),
    fieldRow4("BSB No.", d.bsb, "Acc. No.", d.account),
    fieldRow("Repairs; refer to landlord for advice", d.repairs),
    complianceRow(
      "Presence of Asbestos: Is the owner aware of any asbestos? (Yes/No/Unknown)",
      d.asbestos,
      str(data.asbestos_note),
    ),
    complianceRow(
      "Glass Compliance: Does the owner require a glass audit? (Yes/No)",
      d.glass,
      str(data.glass_note),
    ),
    complianceRow(
      "Smoke Detectors: Does the owner require them to be fitted? (Yes/No)",
      d.smoke,
      str(data.smoke_note),
    ),
    complianceRow(
      "Unapproved Structures: Does the owner know of any? (Yes/No)",
      d.structures,
      str(data.structures_note),
    ),
    fieldRow4("Rates-general (Y/N)", yn(d.rates_general), "Rates-water & sewage (Y/N)", yn(d.rates_water)),
    fieldRow4("Land tax (Y/N)", yn(d.land_tax), "Preferred contact (phone/email)", d.preferred_contact),
    fieldRow4("Body Corporate (Y/N)", yn(d.body_corp), "Fair Clause for Posted People (Y/N)", yn(d.fair_clause)),
    fieldRow("Email Statements (Y/N)", yn(d.email_statements)),
    sectionRow("INSURANCE (refer to clause 5.)", { sub: true }),
    fieldRow4("Building policy insurer", d.building_insurer, "Policy No.", d.building_policy),
    fieldRow("Building renewal date", d.building_renewal),
    fieldRow4("Contents policy insurer", d.contents_insurer, "Policy No.", d.contents_policy),
    fieldRow("Contents renewal date", d.contents_renewal),
    fieldRow4("Landlord insurance insurer", d.landlord_insurer, "Policy No.", d.landlord_policy),
    fieldRow("Landlord insurance renewal date", d.landlord_renewal),
    fieldRow("Other instructions", d.other_instructions),
    fieldRow4("Pets (Y/N)", yn(d.pets), "Groups (Y/N)", yn(d.groups)),
    fieldRow("Legislation note", PMA_LEGISLATION_NOTE),
    fieldRow4(
      "Friend or Power of Attorney to contact in emergency",
      d.emergency_contact,
      "Phone",
      d.emergency_phone,
    ),
    fieldRow("Do you intend to sell the property at the end of the fixed tenancy? (Yes/No)", d.intend_sell),
  ].join("");

  const rowsSpecialInstructions = [
    sectionRow("SPECIAL INSTRUCTIONS"),
    fieldRow(
      "12. Are there any specific instructions that the managing agent needs to know e.g. spa/pool, pets, garden maintenance. Please specify",
      d.special_instructions,
    ),
    sectionRow("LOCATION OF"),
    fieldRow("13. Instruction books for appliances if applicable", d.instruction_books),
    fieldRow("Hot water system", d.hot_water_location),
    fieldRow("Electrical meter box", d.meter_box),
    fieldRow("Water meter / stopcock", d.water_meter),
  ].join("");

  const rowsAdditional = [
    sectionRow("ADDITIONAL INFORMATION"),
    fieldRow("Additional information", d.additional_info),
  ].join("");

  const includeAgent = Boolean(agentSig || str(d.agent_sign_name) || str(d.agent_sig_date));
  const signatureRows = buildSignaturesTable(d, ownerSig, agentSig, includeAgent);

  const body = [
    p("PROPERTY MANAGEMENT AGREEMENT", {
      bold: true,
      color: INK,
      size: "24",
      align: "left",
      after: "60",
    }),
    p("ShareHouseManagers.com.au Pty Ltd · ABN: 27 685 383 493", {
      color: MUTED,
      size: "18",
      align: "left",
      after: "100",
    }),
    headerDocRule(),
    p("INSTRUCTIONS TO ACT AS MANAGING AGENT", {
      bold: true,
      color: INK,
      size: "20",
      align: "left",
      after: "160",
    }),
    table(rowsPropertyDetails),
    p(""),
    table(rowsSpecificInstructions),
    pageBreak(),
    h("Terms and Conditions"),
    renderTerms(data),
    pageBreak(),
    table(rowsSpecialInstructions),
    p(""),
    renderPrivacy(data),
    p(""),
    table(rowsAdditional),
    pageBreak(),
    renderFees(data),
    p(""),
    p("Signatures", { bold: true, color: INK, size: "24", after: "100" }),
    table(signatureRows),
    p(
      "Submitted electronically: "
        + (str(data.submittedAt)
          || new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })),
      { size: "16", color: MUTED, after: "0" },
    ),
  ].join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  let relsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  if (ownerSig) relsXml += signatureDrawingRel(ownerSig.ext, "rIdOwnerSig");
  if (agentSig) relsXml += signatureDrawingRel(agentSig.ext, "rIdAgentSig");
  relsXml += "</Relationships>";

  zip.file("word/_rels/document.xml.rels", relsXml);
  zip.file("word/document.xml", documentXml);

  if (ownerSig) {
    zip.file(
      `word/media/rIdOwnerSig.${ownerSig.ext}`,
      decodeDataUri(options?.ownerSignature || str(data.signature)),
    );
    addImageContentTypeIfNeeded(zip, ownerSig.ext);
  }
  if (agentSig) {
    zip.file(
      `word/media/rIdAgentSig.${agentSig.ext}`,
      decodeDataUri(options?.agentSignature || str(data.agent_signature)),
    );
    addImageContentTypeIfNeeded(zip, agentSig.ext);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
