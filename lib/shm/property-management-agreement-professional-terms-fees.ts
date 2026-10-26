import { mergeDocxRuns } from "./docx-utils";
import {
  PMA_HTML_FEE_ADVERTISING,
  PMA_HTML_FEE_ATTENDANCE,
  PMA_HTML_FEE_GST,
  PMA_HTML_FEE_INITIAL,
  PMA_HTML_FEE_MANAGEMENT,
  PMA_HTML_FEE_MONTHLY,
  PMA_HTML_FEE_QUICK_SIGN,
  PMA_HTML_FEE_RENEGOTIATION,
  PMA_HTML_FEE_TRIBUNAL,
  PMA_HTML_TERM_APPOINTMENT,
  PMA_HTML_TERM_DUTIES_LINES,
  PMA_HTML_TERM_EXPENDITURE,
  PMA_HTML_TERM_INSURANCE,
  PMA_HTML_TERM_KEYS,
  PMA_HTML_TERM_MANAGEMENT_FEES,
  PMA_HTML_TERM_PRIVACY,
  PMA_HTML_TERM_TERMINATION,
  PMA_TEMPLATE_FEE_LINES,
  PMA_TEMPLATE_TERM_MANAGEMENT_FEES,
} from "./property-management-agreement-html-defaults";

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function pmaField(data: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = str(data[key]);
    if (value) return value;
  }
  const fv = data.field_values;
  if (fv && typeof fv === "object") {
    for (const key of keys) {
      const value = str((fv as Record<string, unknown>)[key]);
      if (value) return value;
    }
  }
  return fallback;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainCellText(cellXml: string) {
  return mergeDocxRuns(cellXml)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setCellPlainText(cellXml: string, text: string) {
  if (cellXml.includes("<w:tbl")) return cellXml;
  const escaped = escapeXml(text);
  let replaced = false;
  return cellXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pXml) => {
    if (replaced) return pXml;
    const next = pXml.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/, (_m, attrs) => {
      replaced = true;
      const space = String(attrs).includes("xml:space") ? "" : ' xml:space="preserve"';
      return `<w:t${attrs}${space}>${escaped}</w:t>`;
    });
    return next;
  });
}

/** Professional template stores terms/fees in body paragraphs as well as table cells. */
function forEachTextBlock(documentXml: string, fn: (blockXml: string) => string) {
  let out = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, fn);
  out = out.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    if (cell.includes("<w:tbl")) return cell;
    return fn(cell);
  });
  return out;
}

function replaceCellWhenContains(cellXml: string, needle: string, replacement: string) {
  if (!needle || !replacement) return cellXml;
  const plain = plainCellText(cellXml);
  if (!plain.includes(needle)) return cellXml;
  if (plain === replacement.trim()) return cellXml;
  return setCellPlainText(cellXml, replacement);
}

function replaceWhenCustom(
  xml: string,
  data: Record<string, unknown>,
  keys: string[],
  templateNeedles: string[],
  htmlDefault: string,
) {
  const custom = pmaField(data, keys, htmlDefault);
  if (!custom) return xml;
  let out = xml;
  for (const needle of templateNeedles) {
    if (!needle || needle === custom) continue;
    out = forEachTextBlock(out, (block) => replaceCellWhenContains(block, needle, custom));
  }
  return out;
}

function replaceDutyLines(xml: string, data: Record<string, unknown>) {
  const custom = pmaField(data, ["term_duties", "pma_term_duties"], PMA_HTML_TERM_DUTIES_LINES.join("\n"));
  const customLines = custom.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!customLines.length) return xml;

  let out = xml;
  const tpl = PMA_TEMPLATE_FEE_LINES.dutyLines;
  for (let i = 0; i < tpl.length; i++) {
    const line = customLines[i] ?? customLines[customLines.length - 1];
    if (!line) continue;

    if (i === 1 && tpl[i] === "Collect rent and other monies due to the ") {
      out = forEachTextBlock(out, (cell) => {
        const plain = plainCellText(cell);
        if (!plain.includes("Collect rent and other monies due to the")) return cell;
        return setCellPlainText(cell, line);
      });
      continue;
    }

    const needle = tpl[i];
    if (!needle) continue;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, needle, line));
  }
  return out;
}

function replaceExpenditureBlock(xml: string, data: Record<string, unknown>) {
  const custom = pmaField(data, ["term_expenditure", "pma_term_expenditure"], PMA_HTML_TERM_EXPENDITURE);
  if (!custom) return xml;

  const tpl = PMA_TEMPLATE_FEE_LINES;
  let out = xml;

  out = forEachTextBlock(out, (cell) => {
    const plain = plainCellText(cell);
    if (plain.includes(tpl.expenditureLead.trim())) {
      return setCellPlainText(cell, custom);
    }
    if (
      plain.includes("to deduct statutory charges") ||
      plain.includes("charges from rent or other monies received")
    ) {
      return setCellPlainText(cell, "");
    }
    return cell;
  });

  return out;
}

function replaceFees(xml: string, data: Record<string, unknown>) {
  const tpl = PMA_TEMPLATE_FEE_LINES;
  let out = xml;

  out = replaceWhenCustom(out, data, ["fee_initial_letting", "pma_fee_initial_letting"], [tpl.initial], PMA_HTML_FEE_INITIAL);

  const advCustom = pmaField(data, ["fee_advertising", "pma_fee_advertising"], PMA_HTML_FEE_ADVERTISING);
  if (advCustom) {
    for (const needle of [tpl.advertisingLong, tpl.advertisingShort]) {
      out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, needle, advCustom));
    }
  }

  const quickCustom = pmaField(data, ["fee_quick_rent_sign", "pma_fee_quick_rent_sign"], PMA_HTML_FEE_QUICK_SIGN);
  if (quickCustom) {
    const quickLine = quickCustom.startsWith("Quick Rent")
      ? quickCustom
      : `Quick Rent sign ${quickCustom}`;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, tpl.quickSign, quickLine));
  }

  const attendanceCustom = pmaField(data, ["fee_attendance", "pma_fee_attendance"], PMA_HTML_FEE_ATTENDANCE);
  if (attendanceCustom) {
    const lines = attendanceCustom.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      out = forEachTextBlock(out, (cell) =>
        replaceCellWhenContains(cell, tpl.attendanceLines[0], attendanceCustom),
      );
    } else {
      for (let i = 0; i < tpl.attendanceLines.length; i++) {
        const line = lines[i] ?? lines[lines.length - 1];
        const needle = tpl.attendanceLines[i];
        if (line && needle) {
          out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, needle, line));
        }
      }
    }
  }

  const renegCustom = pmaField(data, ["fee_renegotiation", "pma_fee_renegotiation"], PMA_HTML_FEE_RENEGOTIATION);
  if (renegCustom) {
    const line = renegCustom.includes("Renegotiation")
      ? renegCustom
      : `Renegotiation to secure existing tenants to a new lease ${renegCustom}`;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, tpl.renegotiation, line));
  }

  const mgmtCustom = pmaField(data, ["fee_management", "pma_fee_management"], PMA_HTML_FEE_MANAGEMENT);
  if (mgmtCustom) {
    const line = /management fee/i.test(mgmtCustom)
      ? mgmtCustom
      : `Management fee ${mgmtCustom}`;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, tpl.management, line));
  }

  const monthlyCustom = pmaField(data, ["fee_monthly_statement", "pma_fee_monthly_statement"], PMA_HTML_FEE_MONTHLY);
  if (monthlyCustom) {
    const line = /monthly statement/i.test(monthlyCustom)
      ? monthlyCustom
      : `Monthly Statement and accounting fee ${monthlyCustom}`;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, tpl.monthly, line));
  }

  const tribunalCustom = pmaField(data, ["fee_tribunal", "pma_fee_tribunal"], PMA_HTML_FEE_TRIBUNAL);
  if (tribunalCustom) {
    out = forEachTextBlock(out, (cell) =>
      replaceCellWhenContains(cell, tpl.tribunalCombined, tribunalCustom),
    );
    const tribLines = tribunalCustom.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (tribLines.length > 1) {
      for (let i = 0; i < tpl.tribunalLines.length; i++) {
        const line = tribLines[i] ?? tribLines[tribLines.length - 1];
        const needle = tpl.tribunalLines[i];
        if (line && needle) {
          out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, needle, line));
        }
      }
    }
  }

  const gstCustom = pmaField(data, ["fee_gst", "pma_fee_gst"], PMA_HTML_FEE_GST);
  if (gstCustom) {
    const line = /^N\.B\.?\s/i.test(gstCustom) ? gstCustom : `N.B ${gstCustom}`;
    out = forEachTextBlock(out, (cell) => replaceCellWhenContains(cell, tpl.gst, line));
  }

  return out;
}

/** Apply creator-edited Part D/E terms and fee schedule into the professional Word shell. */
export function applyTermsAndFeesToProfessionalDocument(
  xml: string,
  data: Record<string, unknown>,
): string {
  let out = xml;

  out = replaceWhenCustom(
    out,
    data,
    ["term_appointment", "pma_term_appointment"],
    [PMA_HTML_TERM_APPOINTMENT],
    PMA_HTML_TERM_APPOINTMENT,
  );

  out = replaceWhenCustom(
    out,
    data,
    ["term_management_fees", "pma_term_management_fees"],
    [PMA_HTML_TERM_MANAGEMENT_FEES, PMA_TEMPLATE_TERM_MANAGEMENT_FEES],
    PMA_HTML_TERM_MANAGEMENT_FEES,
  );

  out = replaceWhenCustom(
    out,
    data,
    ["term_termination", "pma_term_termination"],
    [PMA_HTML_TERM_TERMINATION],
    PMA_HTML_TERM_TERMINATION,
  );

  out = replaceWhenCustom(out, data, ["term_keys", "pma_term_keys"], [PMA_HTML_TERM_KEYS], PMA_HTML_TERM_KEYS);

  out = replaceWhenCustom(
    out,
    data,
    ["term_insurance", "pma_term_insurance"],
    [PMA_HTML_TERM_INSURANCE],
    PMA_HTML_TERM_INSURANCE,
  );

  out = replaceDutyLines(out, data);
  out = replaceExpenditureBlock(out, data);

  out = replaceWhenCustom(
    out,
    data,
    ["term_privacy", "pma_term_privacy"],
    [PMA_HTML_TERM_PRIVACY],
    PMA_HTML_TERM_PRIVACY,
  );

  out = replaceFees(out, data);

  return out;
}
