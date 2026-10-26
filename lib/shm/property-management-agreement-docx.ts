import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import { PMA_LEGISLATION_NOTE } from "./property-management-agreement-content";
import {
  fillProfessionalAgreementRows,
  patchSubmittedAtLine,
} from "./property-management-agreement-professional-fill";
import { applyProfessionalParagraphSampleFill } from "./property-management-agreement-professional-paragraph-fill";
import {
  compactPmaProfessionalDocumentLayout,
  ensureWordUpdateFieldsOnOpen,
  refreshWordPageFieldResults,
} from "./property-management-agreement-professional-layout";
import { signatureDrawingRunForImage } from "./signature-image-embed";
import { applyTermsAndFeesToProfessionalDocument } from "./property-management-agreement-professional-terms-fees";

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

export function buildPropertyManagementAgreementTemplateData(data: Record<string, unknown>) {
  return {
    available_from: formatDateAu(data.available_from),
    available_to: formatDateAu(data.available_to),
    property: str(data.property),
    block: str(data.block),
    section: str(data.section),
    division: str(data.division),
    eer: str(data.eer),
    owner: str(data.owner),
    postal_address: str(data.postal_address),
    phone_ah: str(data.phone_ah),
    phone_bh: str(data.phone_bh),
    mobile: str(data.mobile),
    email: str(data.email),
    unit_plan_no: str(data.unit_plan_no),
    unit_plan_manager: str(data.unit_plan_manager),
    unit_phone: str(data.unit_phone),
    fax: str(data.fax),
    description: str(data.description),
    property_type: str(data.property_type),
    heating: str(data.heating),
    hot_water: str(data.hot_water),
    dishwasher: str(data.dishwasher),
    oven: str(data.oven),
    cooktop: str(data.cooktop),
    warranties: str(data.warranties),
    rent_pw: str(data.rent_pw),
    commencement: formatDateAu(data.commencement),
    lease_term: str(data.lease_term),
    keys: str(data.keys),
    deposit_to: str(data.deposit_to),
    bank: str(data.bank),
    branch: str(data.branch),
    bsb: str(data.bsb),
    account: str(data.account),
    repairs: str(data.repairs) || "Refer to landlord for advice",
    asbestos: str(data.asbestos),
    glass: str(data.glass),
    smoke: str(data.smoke),
    structures: str(data.structures),
    rates_general: str(data.rates_general),
    rates_water: str(data.rates_water),
    land_tax: str(data.land_tax),
    preferred_contact: str(data.preferred_contact),
    body_corp: str(data.body_corp),
    fair_clause: str(data.fair_clause),
    email_statements: str(data.email_statements),
    building_insurer: str(data.building_insurer),
    building_policy: str(data.building_policy),
    building_renewal: formatDateAu(data.building_renewal),
    contents_insurer: str(data.contents_insurer),
    contents_policy: str(data.contents_policy),
    contents_renewal: formatDateAu(data.contents_renewal),
    landlord_insurer: str(data.landlord_insurer),
    landlord_policy: str(data.landlord_policy),
    landlord_renewal: formatDateAu(data.landlord_renewal),
    other_instructions: str(data.other_instructions),
    pets: str(data.pets),
    groups: str(data.groups),
    emergency_contact: str(data.emergency_contact),
    emergency_phone: str(data.emergency_phone),
    intend_sell: str(data.intend_sell),
    special_instructions: str(data.special_instructions),
    instruction_books: str(data.instruction_books),
    hot_water_location: str(data.hot_water_location),
    meter_box: str(data.meter_box),
    water_meter: str(data.water_meter),
    additional_info: str(data.additional_info),
    owner_sign_name: str(data.owner_sign_name || data.owner),
    sig_date: formatDateAu(data.sig_date),
    agent_sign_name: str(data.agent_sign_name),
    agent_sig_date: formatDateAu(data.agent_sig_date),
  };
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

function fillCell(value: string) {
  const text = String(value ?? "").trim();
  return text || "—";
}

/** Professional template: leave blank cells empty (no em dash clutter or stale sample text). */
function fillCellProfessional(value: string) {
  return String(value ?? "").trim();
}

function withNote(value: string, note: string) {
  const base = fillCell(value);
  const extra = String(note ?? "").trim();
  if (base === "—") return extra ? `— — ${extra}` : "—";
  return extra ? `${base} — ${extra}` : base;
}

function withNoteProfessional(value: string, note: string) {
  const base = fillCellProfessional(value);
  const extra = String(note ?? "").trim();
  if (!base) return extra;
  return extra ? `${base} — ${extra}` : base;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSignaturePlaceholders(xml: string) {
  return xml.replace(
    /AGENT \(sign\): \[\[AGENT_SIGN_NAME\]\]\s+\[\[OWNER_SIGNATURE\]\]/g,
    "AGENT (sign): [[AGENT_SIGN_NAME]] [[AGENT_SIGNATURE]]",
  );
}

function runTagPrefix(runOpen: string) {
  return runOpen.match(/^<(w|ns\d+):/)?.[1] || "w";
}

function extractRunPrefix(runOpen: string) {
  const prefix = runTagPrefix(runOpen);
  const re = new RegExp(
    `^(<${prefix}:r\\b[^>]*>(?:<${prefix}:rPr>[\\s\\S]*?<\\/${prefix}:rPr>)?)`,
  );
  return runOpen.match(re)?.[1] || `<${prefix}:r>`;
}

function textRunFromOpen(runOpen: string, text: string) {
  if (!text) return "";
  const prefix = runTagPrefix(runOpen);
  const runPrefix = extractRunPrefix(runOpen);
  const tOpenMatch = runOpen.match(new RegExp(`<${prefix}:t[^>]*>$`));
  const tOpen = tOpenMatch?.[0] || `<${prefix}:t xml:space="preserve">`;
  return `${runPrefix}${tOpen}${escapeXml(text)}</${prefix}:t></${prefix}:r>`;
}

function insertSignaturePlaceholder(xml: string, placeholder: string, drawingRun: string) {
  const esc = escapeRegExp(placeholder);
  for (const prefix of ["w", "ns\\d+"]) {
    const runPattern = new RegExp(
      `(<${prefix}:r\\b[^>]*>(?:<${prefix}:rPr>[\\s\\S]*?<\\/${prefix}:rPr>)?<${prefix}:t[^>]*>)([^<]*)${esc}([^<]*)(<\\/${prefix}:t><\\/${prefix}:r>)`,
    );
    if (!runPattern.test(xml)) continue;
    return xml.replace(runPattern, (_full, runOpen, before, after) => {
      const beforeRun = textRunFromOpen(runOpen, before);
      const afterRun = textRunFromOpen(runOpen, after);
      return `${beforeRun}${drawingRun}${afterRun}`;
    });
  }
  return replaceAll(xml, placeholder, "");
}

function decodeDataUri(dataUri: string) {
  const raw = String(dataUri || "").trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) return Buffer.from(match[2], "base64");
  return Buffer.from(raw, "base64");
}

function getSignatureInfo(dataUrl: string) {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const dataMatch = raw.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (dataMatch) {
    const extRaw = dataMatch[1].toLowerCase();
    const ext = extRaw === "jpeg" ? "jpg" : extRaw;
    return { ext, base64: dataMatch[2] };
  }
  const compact = raw.replace(/\s/g, "");
  if (compact.length > 200 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    return { ext: "png", base64: compact };
  }
  return null;
}

function signatureDrawingRel(ext: string, target: string) {
  return `<Relationship Id="${target}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${target}.${ext}"/>`;
}

/** Professional template uses "Owner (Sign)" / "Agent (Sign)" labels + bordered line paragraphs — not [[TOKENS]]. */
function injectSignaturePlaceholderAfterLabel(xml: string, label: string, placeholder: string) {
  if (xml.includes(placeholder)) return xml;
  const labelEsc = escapeRegExp(label);
  const labelParaRe = new RegExp(
    `(<w:p\\b[\\s\\S]*?<w:t(?:[^>]*)>[^<]*${labelEsc}[^<]*</w:t>[\\s\\S]*?</w:p>)`,
    "i",
  );
  const labelMatch = labelParaRe.exec(xml);
  if (!labelMatch) return xml;

  const afterIdx = labelMatch.index + labelMatch[0].length;
  const tail = xml.slice(afterIdx);
  const nextParaRe = /^(\s*<w:p\b[\s\S]*?<\/w:p>)/;
  const nextMatch = nextParaRe.exec(tail);
  if (!nextMatch) return xml;

  const nextPara = nextMatch[1];
  if (nextPara.includes(placeholder)) return xml;

  const safePlaceholder = escapeXml(placeholder);
  let newNextPara = nextPara;
  const textRunRe = /(<w:t(?:[^>]*)>)([^<]*)(<\/w:t>)/;
  if (textRunRe.test(nextPara)) {
    newNextPara = nextPara.replace(textRunRe, `$1${safePlaceholder}$3`);
  } else {
    const insertRun = `<w:r><w:t xml:space="preserve">${safePlaceholder}</w:t></w:r>`;
    if (/<\/w:pPr>/.test(nextPara)) {
      newNextPara = nextPara.replace(/<\/w:pPr>/, `</w:pPr>${insertRun}`);
    } else {
      newNextPara = nextPara.replace(/(<w:p\b[^>]*>)/, `$1${insertRun}`);
    }
  }

  const replaceAt = afterIdx + (nextMatch.index || 0);
  return xml.slice(0, replaceAt) + newNextPara + xml.slice(replaceAt + nextPara.length);
}

function ensurePmaProfessionalSignaturePlaceholders(xml: string) {
  let out = xml;
  out = injectSignaturePlaceholderAfterLabel(out, "Owner (Sign)", "[[OWNER_SIGNATURE]]");
  out = injectSignaturePlaceholderAfterLabel(out, "Agent (Sign)", "[[AGENT_SIGNATURE]]");
  return out;
}

/** Replace the bordered line paragraph after a signature label with a drawing run (avoids fragile full-doc regex). */
function replaceSignatureLineAfterLabel(xml: string, label: string, drawingRun: string) {
  const labelEsc = escapeRegExp(label);
  const labelParaRe = new RegExp(
    `(<w:p\\b[\\s\\S]*?<w:t(?:[^>]*)>[^<]*${labelEsc}[^<]*</w:t>[\\s\\S]*?</w:p>)`,
    "i",
  );
  const labelMatch = labelParaRe.exec(xml);
  if (!labelMatch) return xml;

  const afterIdx = labelMatch.index + labelMatch[0].length;
  const tail = xml.slice(afterIdx, afterIdx + 8000);
  const borderedParaRe = /^(\s*)(<w:p\b[\s\S]*?<w:pBdr[\s\S]*?<w:bottom[\s\S]*?<\/w:p>)/;
  const nextParaRe = /^(\s*)(<w:p\b[\s\S]*?<\/w:p>)/;
  const nextMatch = borderedParaRe.exec(tail) || nextParaRe.exec(tail);
  if (!nextMatch) return xml;

  const nextPara = nextMatch[2];
  const pOpen = nextPara.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
  const pPrMatch = nextPara.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch?.[0] || "";
  const newNextPara = `${pOpen}${pPr}${drawingRun}</w:p>`;
  const replaceAt = afterIdx + (nextMatch.index || 0) + nextMatch[1].length;
  return xml.slice(0, replaceAt) + newNextPara + xml.slice(replaceAt + nextPara.length);
}

function applyProfessionalLabelSignature(
  xml: string,
  label: string,
  dataUrl: string | undefined,
  relId: string,
  mediaName: string,
  docPrId: number,
) {
  if (!dataUrl) return xml;
  const info = getSignatureInfo(dataUrl);
  if (!info) return xml;
  const buffer = decodeDataUri(dataUrl);
  const drawingRun = signatureDrawingRunForImage(relId, mediaName, docPrId, buffer, info.ext);
  return replaceSignatureLineAfterLabel(xml, label, drawingRun);
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
  const buffer = decodeDataUri(dataUrl);
  const drawingRun = signatureDrawingRunForImage(relId, mediaName, docPrId, buffer, info.ext);
  return insertSignaturePlaceholder(xml, placeholder, drawingRun);
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
        : ext === "webp"
          ? "image/webp"
          : "application/octet-stream";
  ct = ct.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
  zip.file("[Content_Types].xml", ct);
}

function applyTemplatePlaceholders(
  xml: string,
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  const d = buildPropertyManagementAgreementTemplateData(data);
  // Professional template keeps terms/fees in nested tables — only merge runs when filling signatures.
  let out = compactPmaProfessionalDocumentLayout(normalizeSignaturePlaceholders(xml));

  const submittedAt = str(
    data.submittedAt,
    new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }),
  );

  const cell = fillCellProfessional;
  const note = withNoteProfessional;

  const pairs: Array<[string, string]> = [
    ["[[AVAILABLE_FROM]]", cell(d.available_from)],
    ["[[AVAILABLE_TO]]", cell(d.available_to)],
    ["[[PROPERTY]]", cell(d.property)],
    ["[[BLOCK]]", cell(d.block)],
    ["[[SECTION]]", cell(d.section)],
    ["[[DIVISION]]", cell(d.division)],
    ["[[EER]]", cell(d.eer)],
    ["[[OWNER]]", cell(d.owner)],
    ["[[POSTAL_ADDRESS]]", cell(d.postal_address)],
    ["[[PHONE_AH]]", cell(d.phone_ah)],
    ["[[PHONE_BH]]", cell(d.phone_bh)],
    ["[[MOBILE]]", cell(d.mobile)],
    ["[[EMAIL]]", cell(d.email)],
    ["[[UNIT_PLAN_NO]]", cell(d.unit_plan_no)],
    ["[[UNIT_PLAN_MANAGER]]", cell(d.unit_plan_manager)],
    ["[[UNIT_PHONE]]", cell(d.unit_phone)],
    ["[[FAX]]", cell(d.fax)],
    ["[[DESCRIPTION]]", cell(d.description)],
    ["[[PROPERTY_TYPE]]", cell(d.property_type)],
    ["[[HEATING]]", cell(d.heating)],
    ["[[HOT_WATER]]", cell(d.hot_water)],
    ["[[DISHWASHER]]", cell(d.dishwasher)],
    ["[[OVEN]]", cell(d.oven)],
    ["[[COOKTOP]]", cell(d.cooktop)],
    ["[[WARRANTIES]]", cell(d.warranties)],
    ["[[RENT_PW]]", cell(d.rent_pw)],
    ["[[COMMENCEMENT]]", cell(d.commencement)],
    ["[[LEASE_TERM]]", cell(d.lease_term)],
    ["[[KEYS]]", cell(d.keys)],
    ["[[DEPOSIT_TO]]", cell(d.deposit_to)],
    ["[[BANK]]", cell(d.bank)],
    ["[[BRANCH]]", cell(d.branch)],
    ["[[BSB]]", cell(d.bsb)],
    ["[[ACCOUNT]]", cell(d.account)],
    ["[[REPAIRS]]", cell(d.repairs)],
    ["[[ASBESTOS]]", note(d.asbestos, str(data.asbestos_note))],
    ["[[GLASS]]", note(d.glass, str(data.glass_note))],
    ["[[SMOKE]]", note(d.smoke, str(data.smoke_note))],
    ["[[STRUCTURES]]", note(d.structures, str(data.structures_note))],
    ["[[RATES_GENERAL]]", cell(d.rates_general)],
    ["[[RATES_WATER]]", cell(d.rates_water)],
    ["[[LAND_TAX]]", cell(d.land_tax)],
    ["[[PREFERRED_CONTACT]]", cell(d.preferred_contact)],
    ["[[BODY_CORP]]", cell(d.body_corp)],
    ["[[FAIR_CLAUSE]]", cell(d.fair_clause)],
    ["[[EMAIL_STATEMENTS]]", cell(d.email_statements)],
    ["[[BUILDING_INSURER]]", cell(d.building_insurer)],
    ["[[BUILDING_POLICY]]", cell(d.building_policy)],
    ["[[BUILDING_RENEWAL]]", cell(d.building_renewal)],
    ["[[CONTENTS_INSURER]]", cell(d.contents_insurer)],
    ["[[CONTENTS_POLICY]]", cell(d.contents_policy)],
    ["[[CONTENTS_RENEWAL]]", cell(d.contents_renewal)],
    ["[[LANDLORD_INSURER]]", cell(d.landlord_insurer)],
    ["[[LANDLORD_POLICY]]", cell(d.landlord_policy)],
    ["[[LANDLORD_RENEWAL]]", cell(d.landlord_renewal)],
    ["[[OTHER_INSTRUCTIONS]]", cell(d.other_instructions)],
    ["[[PETS]]", cell(d.pets)],
    ["[[GROUPS]]", cell(d.groups)],
    ["[[LEGISLATION_NOTE]]", PMA_LEGISLATION_NOTE],
    ["[[EMERGENCY_CONTACT]]", cell(d.emergency_contact)],
    ["[[EMERGENCY_PHONE]]", cell(d.emergency_phone)],
    ["[[INTEND_SELL]]", cell(d.intend_sell)],
    ["[[SPECIAL_INSTRUCTIONS]]", cell(d.special_instructions)],
    ["[[INSTRUCTION_BOOKS]]", cell(d.instruction_books)],
    ["[[HOT_WATER_LOCATION]]", cell(d.hot_water_location)],
    ["[[METER_BOX]]", cell(d.meter_box)],
    ["[[WATER_METER]]", cell(d.water_meter)],
    ["[[ADDITIONAL_INFO]]", cell(d.additional_info)],
    ["[[OWNER_SIGN_NAME]]", cell(d.owner_sign_name)],
    ["[[OWNER_SIG_DATE]]", cell(d.sig_date)],
    ["[[AGENT_SIGN_NAME]]", cell(d.agent_sign_name || "Ishaq M")],
    ["[[AGENT_SIG_DATE]]", cell(d.agent_sig_date)],
    ["[[SUBMITTED_AT]]", submittedAt],
  ];

  const valueByToken = new Map<string, string>(pairs);
  out = fillProfessionalAgreementRows(out, valueByToken);
  out = applyTermsAndFeesToProfessionalDocument(out, data);
  out = applyProfessionalParagraphSampleFill(out, data, d);
  out = patchSubmittedAtLine(out, submittedAt);

  // Legacy templates may still contain [[TOKENS]] from an older build — replace any leftovers.
  for (const [needle, value] of pairs) {
    if (out.includes(needle)) out = replaceAll(out, needle, value);
  }

  const ownerSig = options?.ownerSignature || str(data.signature);
  const agentSig = options?.agentSignature || str(data.agent_signature);
  const professionalShell = out.includes("Owner (Sign)") && out.includes("Agent (Sign)");
  if (professionalShell) {
    out = applyProfessionalLabelSignature(
      out,
      "Owner (Sign)",
      ownerSig,
      "rIdPmaOwnerSig",
      "Owner Signature",
      991001,
    );
    out = applyProfessionalLabelSignature(
      out,
      "Agent (Sign)",
      agentSig,
      "rIdPmaAgentSig",
      "Agent Signature",
      991002,
    );
  } else {
    out = ensurePmaProfessionalSignaturePlaceholders(out);
    out = applySignaturePlaceholder(out, "[[OWNER_SIGNATURE]]", ownerSig, "rIdOwnerSig", "Owner Signature", 9101);
    out = applySignaturePlaceholder(out, "[[AGENT_SIGNATURE]]", agentSig, "rIdAgentSig", "Agent Signature", 9102);
  }

  return out;
}

async function resolveTemplatePath() {
  const candidates = [
    path.join(
      process.cwd(),
      "lib",
      "shm",
      "templates",
      "property-management-agreement-professional-template.docx",
    ),
    path.join(
      process.cwd(),
      "public",
      "shm-plugin-assets",
      "templates",
      "property-management-agreement-professional-template.docx",
    ),
    path.join(process.cwd(), "lib", "shm", "templates", "property-management-agreement-template.docx"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "property-management-agreement-template.docx"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error("Property management agreement template file is missing on the server.");
}

export async function generatePropertyManagementAgreementDocx(
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  const templatePath = await resolveTemplatePath();
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Property management agreement template is missing document.xml.");
  }

  const xml = documentFile.asText();
  const filled = applyTemplatePlaceholders(xml, data, options);
  zip.file("word/document.xml", filled);

  const footerFile = zip.file("word/footer1.xml");
  if (footerFile) {
    zip.file("word/footer1.xml", refreshWordPageFieldResults(footerFile.asText()));
  }
  const settingsFile = zip.file("word/settings.xml");
  if (settingsFile) {
    zip.file("word/settings.xml", ensureWordUpdateFieldsOnOpen(settingsFile.asText()));
  }

  const relsFile = zip.file("word/_rels/document.xml.rels");
  let relsXml = relsFile ? relsFile.asText() : "";
  const mediaEntries: Array<{ relId: string; ext: string; buffer: Buffer }> = [];

  const ownerSigUri = options?.ownerSignature || str(data.signature);
  const agentSigUri = options?.agentSignature || str(data.agent_signature);

  const xmlAfterFill = zip.file("word/document.xml")?.asText() || "";
  const professionalShell =
    xmlAfterFill.includes("Owner (Sign)") && xmlAfterFill.includes("Agent (Sign)");
  const ownerRelId = professionalShell ? "rIdPmaOwnerSig" : "rIdOwnerSig";
  const agentRelId = professionalShell ? "rIdPmaAgentSig" : "rIdAgentSig";

  if (ownerSigUri) {
    const info = getSignatureInfo(ownerSigUri);
    if (info) {
      mediaEntries.push({ relId: ownerRelId, ext: info.ext, buffer: decodeDataUri(ownerSigUri) });
      if (!relsXml.includes(`Id="${ownerRelId}"`)) {
        relsXml = relsXml.replace(
          "</Relationships>",
          `${signatureDrawingRel(info.ext, ownerRelId)}</Relationships>`,
        );
      }
    }
  }

  if (agentSigUri) {
    const info = getSignatureInfo(agentSigUri);
    if (info) {
      mediaEntries.push({ relId: agentRelId, ext: info.ext, buffer: decodeDataUri(agentSigUri) });
      if (!relsXml.includes(`Id="${agentRelId}"`)) {
        relsXml = relsXml.replace(
          "</Relationships>",
          `${signatureDrawingRel(info.ext, agentRelId)}</Relationships>`,
        );
      }
    }
  }

  for (const entry of mediaEntries) {
    zip.file(`word/media/${entry.relId}.${entry.ext}`, entry.buffer);
    addImageContentTypeIfNeeded(zip, entry.ext);
  }
  if (relsFile && mediaEntries.length > 0) {
    zip.file("word/_rels/document.xml.rels", relsXml);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
