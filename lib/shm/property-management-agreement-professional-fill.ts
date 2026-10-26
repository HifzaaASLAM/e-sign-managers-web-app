/** Row-based fill for the professional PMA Word shell (reference layout unchanged). */

const SECTION_LABELS = new Set([
  "property details",
  "special instructions",
  "location of",
  "additional information",
  "signatures",
]);

const LABEL_MAP = new Map<string, string>(
  Object.entries({
    "available from": "[[AVAILABLE_FROM]]",
    "available to": "[[AVAILABLE_TO]]",
    "property to be managed": "[[PROPERTY]]",
    block: "[[BLOCK]]",
    section: "[[SECTION]]",
    division: "[[DIVISION]]",
    eer: "[[EER]]",
    "owner (lessor/s)": "[[OWNER]]",
    "postal address": "[[POSTAL_ADDRESS]]",
    "phone (a.h.)": "[[PHONE_AH]]",
    "phone (b.h.)": "[[PHONE_BH]]",
    mobile: "[[MOBILE]]",
    email: "[[EMAIL]]",
    "unit plan no.": "[[UNIT_PLAN_NO]]",
    "unit plan manager": "[[UNIT_PLAN_MANAGER]]",
    "unit plan phone": "[[UNIT_PHONE]]",
    fax: "[[FAX]]",
    "property description": "[[DESCRIPTION]]",
    "property type": "[[PROPERTY_TYPE]]",
    heating: "[[HEATING]]",
    "hot water": "[[HOT_WATER]]",
    dishwasher: "[[DISHWASHER]]",
    oven: "[[OVEN]]",
    cooktop: "[[COOKTOP]]",
    warranties: "[[WARRANTIES]]",
    "rent (pw)": "[[RENT_PW]]",
    "at commencement": "[[COMMENCEMENT]]",
    "preferred lease term": "[[LEASE_TERM]]",
    "keys supplied (refer to clause 4.)": "[[KEYS]]",
    "deposit to credit of": "[[DEPOSIT_TO]]",
    bank: "[[BANK]]",
    branch: "[[BRANCH]]",
    "bsb no.": "[[BSB]]",
    "acc. no.": "[[ACCOUNT]]",
    "repairs; refer to landlord for advice": "[[REPAIRS]]",
    "rates-general (y/n)": "[[RATES_GENERAL]]",
    "rates-water & sewage (y/n)": "[[RATES_WATER]]",
    "land tax (y/n)": "[[LAND_TAX]]",
    "preferred contact (phone/email)": "[[PREFERRED_CONTACT]]",
    "body corporate (y/n)": "[[BODY_CORP]]",
    "fair clause for posted people (y/n)": "[[FAIR_CLAUSE]]",
    "email statements (y/n)": "[[EMAIL_STATEMENTS]]",
    "building policy insurer": "[[BUILDING_INSURER]]",
    "building renewal date": "[[BUILDING_RENEWAL]]",
    "contents policy insurer": "[[CONTENTS_INSURER]]",
    "contents renewal date": "[[CONTENTS_RENEWAL]]",
    "landlord insurance insurer": "[[LANDLORD_INSURER]]",
    "landlord insurance renewal date": "[[LANDLORD_RENEWAL]]",
    "other instructions": "[[OTHER_INSTRUCTIONS]]",
    "pets (y/n)": "[[PETS]]",
    "groups (y/n)": "[[GROUPS]]",
    "hot water system": "[[HOT_WATER_LOCATION]]",
    "electrical meter box": "[[METER_BOX]]",
    "water meter / stopcock": "[[WATER_METER]]",
    "owner name": "[[OWNER_SIGN_NAME]]",
    "owner (sign)": "[[OWNER_SIGNATURE]]",
    "owner date": "[[OWNER_SIG_DATE]]",
    "agent name": "[[AGENT_SIGN_NAME]]",
    "agent (sign)": "[[AGENT_SIGNATURE]]",
    "agent date": "[[AGENT_SIG_DATE]]",
  }),
);

function normLabel(s: string) {
  return String(s || "")
    .replace(/\u2014/g, "-")
    .replace(/&amp;/g, "&")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findTcTag(documentXml: string, from: number, kind: "open" | "close") {
  let p = from;
  while (p < documentXml.length) {
    if (kind === "open") {
      const idx = documentXml.indexOf("<w:tc", p);
      if (idx === -1) return -1;
      const next = documentXml[idx + 5];
      if (next === ">" || next === " " || next === "/") return idx;
      p = idx + 5;
      continue;
    }
    return documentXml.indexOf("</w:tc>", p);
  }
  return -1;
}

function extractDirectRowCells(rowXml: string) {
  const rowOpenEnd = rowXml.indexOf(">");
  if (rowOpenEnd === -1) return [];
  const rowClose = rowXml.lastIndexOf("</w:tr>");
  if (rowClose === -1) return [];
  const cells: string[] = [];
  let pos = rowOpenEnd + 1;
  while (pos < rowClose) {
    const start = findTcTag(rowXml, pos, "open");
    if (start === -1 || start >= rowClose) break;
    const openEnd = rowXml.indexOf(">", start);
    if (openEnd === -1) break;
    let depth = 1;
    let p = openEnd + 1;
    while (p < rowClose && depth > 0) {
      const open = findTcTag(rowXml, p, "open");
      const close = findTcTag(rowXml, p, "close");
      if (close === -1 || close > rowClose) break;
      if (open !== -1 && open < close) {
        depth += 1;
        p = open + 5;
      } else {
        depth -= 1;
        p = close + 7;
      }
    }
    cells.push(rowXml.slice(start, p));
    pos = p;
  }
  return cells;
}

function cellText(cellXml: string) {
  const paras = cellXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  for (let i = paras.length - 1; i >= 0; i--) {
    const text = [...paras[i].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only update the first text run in the first paragraph — never nested tables (terms/fees). */
function setCellValue(cellXml: string, value: string) {
  if (cellXml.includes("<w:tbl")) return cellXml;
  const text = escapeXml(value);
  let replaced = false;
  return cellXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
    if (replaced) return pXml;
    const next = pXml.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/, (_m, attrs) => {
      replaced = true;
      const space = String(attrs).includes("xml:space") ? "" : ' xml:space="preserve"';
      return `<w:t${attrs}${space}>${text}</w:t>`;
    });
    return next;
  });
}

function isComplianceLabel(label: string) {
  return (
    label.includes("asbestos") ||
    label.includes("glass compliance") ||
    label.includes("smoke detectors") ||
    label.includes("unapproved structures")
  );
}

function valueCellIndex(cells: string[], labelIndex: number, label: string) {
  if (isComplianceLabel(label) && cells.length >= 4) return cells.length - 1;
  const next = labelIndex + 1;
  return next < cells.length ? next : -1;
}

function tokenForLabel(label: string, policyNoIndex: number) {
  if (SECTION_LABELS.has(label)) return null;
  if (label === "policy no.") {
    return policyNoIndex === 0 ? "[[BUILDING_POLICY]]" : "[[CONTENTS_POLICY]]";
  }
  if (label.includes("asbestos")) return "[[ASBESTOS]]";
  if (label.includes("glass compliance")) return "[[GLASS]]";
  if (label.includes("smoke detectors")) return "[[SMOKE]]";
  if (label.includes("unapproved structures")) return "[[STRUCTURES]]";
  if (label.includes("legislation note")) return "[[LEGISLATION_NOTE]]";
  if (label.includes("friend or power of attorney")) return "[[EMERGENCY_CONTACT]]";
  if (label === "phone" || label === "phone:") return "[[EMERGENCY_PHONE]]";
  if (label.includes("intend to sell")) return "[[INTEND_SELL]]";
  if (label.startsWith("12.") && label.includes("specific instructions")) return "[[SPECIAL_INSTRUCTIONS]]";
  if (label.startsWith("13.") && label.includes("instruction books")) return "[[INSTRUCTION_BOOKS]]";
  if (label.includes("payment of monies")) return null;
  if (label.includes("additional information") && !label.includes("12.")) {
    return label === "additional information" ? null : "[[ADDITIONAL_INFO]]";
  }
  return LABEL_MAP.get(label) || null;
}

export function fillProfessionalAgreementRows(
  documentXml: string,
  valueByToken: Map<string, string>,
) {
  let policyNoIndex = 0;

  return documentXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rowXml) => {
    const cells = extractDirectRowCells(rowXml);
    if (cells.length < 2) return rowXml;
    if (cells.some((c) => c.includes("<w:tbl"))) return rowXml;

    let newRow = rowXml;
    for (let i = 0; i < cells.length; i++) {
      const label = normLabel(cellText(cells[i]));
      const token = tokenForLabel(label, policyNoIndex);
      if (label === "policy no.") policyNoIndex += 1;
      if (!token) continue;
      const valueIndex = valueCellIndex(cells, i, label);
      if (valueIndex < 0) continue;
      const value = valueByToken.get(token);
      if (value === undefined) continue;
      const updated = setCellValue(cells[valueIndex], value);
      if (updated === cells[valueIndex]) continue;
      newRow = newRow.replace(cells[valueIndex], updated);
      if (isComplianceLabel(label) && cells.length >= 4) {
        for (let j = i + 1; j < cells.length - 1; j++) {
          const cleared = setCellValue(cells[j], "");
          if (cleared !== cells[j]) newRow = newRow.replace(cells[j], cleared);
        }
      }
    }
    return newRow;
  });
}

export function patchSubmittedAtLine(documentXml: string, submittedAt: string) {
  return documentXml.replace(
    /Submitted electronically:[^<]*/g,
    `Submitted electronically: ${submittedAt}`,
  );
}
