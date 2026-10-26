import fs from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { buildOwnershipStatementHtml } from "./ownership-statement-html";

type RentRow = {
  rent_property: string;
  rent_tenancy: string;
  rent_amount: string;
  rent_period: string;
  rent_paid_from: string;
  rent_paid_to: string;
  rent_total: string;
};

type MaintenanceRow = {
  maintenance_date: string;
  maintenance_inv: string;
  maintenance_description: string;
  maintenance_total: string;
};

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function parseMoney(value: unknown) {
  const n = parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: unknown) {
  const n = parseMoney(value);
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmount(value: unknown) {
  const n = parseMoney(value);
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateAu(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

function splitPeriod(value: unknown) {
  const raw = str(value);
  if (!raw) return { paidFrom: "", paidTo: "" };
  const parts = raw.split(/\s+to\s+/i);
  if (parts.length >= 2) {
    return { paidFrom: parts[0].trim(), paidTo: parts.slice(1).join(" to ").trim() };
  }
  return { paidFrom: raw, paidTo: "" };
}

function buildRentRows(data: Record<string, unknown>): RentRow[] {
  const fromArray = Array.isArray(data.rent_rows) ? data.rent_rows : [];
  if (fromArray.length) {
    return fromArray.map((row) => {
      const item = row as Record<string, unknown>;
      const period = splitPeriod(item.period);
      return {
        rent_property: str(item.property),
        rent_tenancy: str(item.tenancy),
        rent_amount: str(item.amount),
        rent_period: str(item.period),
        rent_paid_from: period.paidFrom,
        rent_paid_to: period.paidTo,
        rent_total: str(item.total) || formatMoney(item.total),
      };
    });
  }

  const rows: RentRow[] = [];
  for (let i = 1; i <= 40; i += 1) {
    const rent_property = str(data[`rent_property_${i}`]);
    const rent_tenancy = str(data[`rent_tenancy_${i}`]);
    const rent_amount = str(data[`rent_amount_${i}`]);
    const rent_period = str(data[`rent_period_${i}`]);
    const rent_total = str(data[`rent_total_${i}`]) || formatMoney(data[`rent_total_${i}`]);
    if (!rent_property && !rent_tenancy && !rent_amount && !rent_period && !rent_total) continue;
    const period = splitPeriod(rent_period);
    rows.push({
      rent_property,
      rent_tenancy,
      rent_amount,
      rent_period,
      rent_paid_from: period.paidFrom,
      rent_paid_to: period.paidTo,
      rent_total,
    });
  }
  return rows;
}

const EMPTY_MAINTENANCE_ROW: MaintenanceRow = {
  maintenance_date: "",
  maintenance_inv: "",
  maintenance_description: "",
  maintenance_total: "0.00",
};

function hasMaintenanceEntry(refRaw: string, description: string, totalRaw: unknown) {
  const totalText = str(totalRaw);
  return Boolean(refRaw || description || (totalText && parseMoney(totalRaw) !== 0));
}

function mapMaintenanceRow(refRaw: string, description: string, totalRaw: unknown): MaintenanceRow {
  const totalText = str(totalRaw);
  return {
    maintenance_date: refRaw,
    maintenance_inv: "",
    maintenance_description: description,
    maintenance_total: totalText ? formatAmount(totalRaw) : "0.00",
  };
}

function buildMaintenanceRows(data: Record<string, unknown>): MaintenanceRow[] {
  const rows: MaintenanceRow[] = [];
  const fromArray = Array.isArray(data.maintenance_rows) ? data.maintenance_rows : [];

  if (fromArray.length) {
    for (const row of fromArray) {
      const item = row as Record<string, unknown>;
      const refRaw = str(item.ref || item.inv || item.maintenance_date);
      const description = str(item.description || item.maintenance_description);
      const totalRaw = item.total ?? item.maintenance_total;
      if (!hasMaintenanceEntry(refRaw, description, totalRaw)) continue;
      rows.push(mapMaintenanceRow(refRaw, description, totalRaw));
    }
  } else {
    for (let i = 1; i <= 40; i += 1) {
      const refRaw = str(data[`maintenance_ref_${i}`]);
      const maintenance_description = str(data[`maintenance_description_${i}`]);
      const totalRaw = data[`maintenance_total_${i}`];
      if (!hasMaintenanceEntry(refRaw, maintenance_description, totalRaw)) continue;
      rows.push(mapMaintenanceRow(refRaw, maintenance_description, totalRaw));
    }
  }

  return rows.length ? rows : [{ ...EMPTY_MAINTENANCE_ROW }];
}

function shortStatementPeriod(value: unknown) {
  const raw = str(value);
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return raw;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[parseInt(match[2], 10) - 1] || match[2];
  const year = match[3].length === 2 ? match[3] : match[3].slice(-2);
  return `${month}${year}`;
}

export function buildOwnershipStatementTemplateData(data: Record<string, unknown>) {
  const ownershipId = str(data.ownership_id);
  const companyName = str(data.statement_title) || str(data.owner_name);
  const statementHeading = ownershipId
    ? `OWNERSHIP STATEMENT#${ownershipId}- ${companyName}`
    : `OWNERSHIP STATEMENT - ${companyName}`;

  const statementPeriod = str(data.statement_period);
  const feeDescriptionValue = parseMoney(data.fee_description);
  const feeGstValue = parseMoney(data.fee_gst);
  const feeMoneyOutValue = parseMoney(data.fee_money_out) || feeDescriptionValue + feeGstValue;
  const totalRentValue = parseMoney(data.total_rent);
  const summaryRentalPaymentsValue = parseMoney(data.summary_rental_payments || data.total_rent);
  const summaryMaintenanceValue = parseMoney(data.summary_maintenance || data.total_maintenance);
  const totalFeesMaintenanceValue = parseMoney(data.total_fees_maintenance) || feeMoneyOutValue + summaryMaintenanceValue;
  // OWNERSHIP PAYMENTS subtotal/total must be Money In - Money Out.
  const paidToOwnerValue = summaryRentalPaymentsValue - totalFeesMaintenanceValue;

  const feeDescription = formatMoney(feeDescriptionValue);
  const feeGst = formatMoney(feeGstValue);
  const feeMoneyOut = formatMoney(feeMoneyOutValue);
  const totalRent = formatMoney(totalRentValue);
  const summaryRentalPayments = formatMoney(summaryRentalPaymentsValue);
  const summaryFees = formatMoney(feeMoneyOutValue);
  const summaryMaintenance = formatMoney(summaryMaintenanceValue);
  const paidToOwner = formatMoney(paidToOwnerValue);
  const paidToOwnerNegative = paidToOwner.startsWith("-") ? paidToOwner : `-${paidToOwner}`;
  const totalFeesMaintenance = formatMoney(totalFeesMaintenanceValue);
  const generatedOn = formatDateAu(data.generated_on) || formatDateAu(data.admin_signature_date);
  const feeLabel = statementPeriod
    ? `Share House Management Fee ${shortStatementPeriod(statementPeriod)}`
    : "Share House Management Fee";

  return {
    statement_heading: statementHeading,
    statement_period: statementPeriod,
    ownership_id: ownershipId,
    opening_balance: formatMoney(data.opening_balance),
    closing_balance: formatMoney(data.closing_balance),
    ownership_payment: paidToOwner,
    owner_name: str(data.owner_name || data.owner_name_field),
    company_name: companyName,
    owner_address: str(data.owner_address),
    owner_phone: str(data.owner_phone),
    owner_email: str(data.owner_email || data.owner_email_field),
    fee_label: feeLabel,
    fee_gst: feeGst,
    fee_money_out: feeDescription,
    fee_total: `-${feeMoneyOut}`,
    total_rent: totalRent,
    total_fees_maintenance: totalFeesMaintenance,
    summary_rental_payments: summaryRentalPayments,
    summary_management_fees: summaryFees,
    summary_maintenance: summaryMaintenance,
    summary_paid_to_owner: paidToOwner,
    summary_paid_to_owner_negative: paidToOwnerNegative,
    ownership_payment_ref: str(data.ownership_payment_ref),
    ownership_payment_description: str(data.ownership_payment_description),
    ownership_payment_date: formatDateAu(data.ownership_payment_date || data.admin_signature_date),
    generated_on: generatedOn,
    rent_rows: buildRentRows(data),
    maintenance_rows: buildMaintenanceRows(data),
  };
}

export async function generateOwnershipStatementDocx(data: Record<string, unknown>) {
  const templatePath = await resolveTemplatePath();
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  doc.render(buildOwnershipStatementTemplateData(data));
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

async function resolveTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "lib", "shm", "templates", "ownership-statement-template.docx"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "ownership-statement-template.docx"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next location
    }
  }

  throw new Error("Ownership statement template file is missing on the server.");
}

async function convertHtmlToPdfViaPdfShift(html: string) {
  const apiKey = process.env.PDF_API_KEY?.trim();
  const apiUrl = process.env.PDF_API_URL?.trim() || "https://api.pdfshift.io/v3/convert/pdf";
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        source: html,
        landscape: false,
        use_print: true,
        format: "A4",
        margin: "12mm",
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function renderOwnershipStatementPdf(data: Record<string, unknown>) {
  const html = await buildOwnershipStatementHtml(data);
  return renderHtmlToPdf(html);
}

export async function renderHtmlToPdf(html: string) {
  return convertHtmlToPdfViaPdfShift(html);
}

export async function generateOwnershipStatementPdf(data: Record<string, unknown>) {
  const pdfBuffer = await renderOwnershipStatementPdf(data);
  if (pdfBuffer) {
    return { buffer: pdfBuffer, fileNameSuffix: "pdf", mimeType: "application/pdf" };
  }

  const docxBuffer = await generateOwnershipStatementDocx(data);
  return {
    buffer: docxBuffer,
    fileNameSuffix: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export type OwnershipStatementGeneratedFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  docxBuffer: Buffer;
  pdf: { fileName: string; mimeType: string; buffer: Buffer } | null;
  docx: { fileName: string; mimeType: string; buffer: Buffer };
};

export async function generateOwnershipStatementFile(
  data: Record<string, unknown>,
  ownerName: string,
  signatureDate: string,
): Promise<OwnershipStatementGeneratedFile> {
  const safeOwner = ownerName.replace(/\s+/g, "-");
  const safeDate = signatureDate || new Date().toISOString().slice(0, 10);
  const baseName = `Ownership-Statement-${safeOwner}-${safeDate}`;
  const [docxBuffer, pdfBuffer] = await Promise.all([
    generateOwnershipStatementDocx(data),
    renderOwnershipStatementPdf(data),
  ]);
  const docx = {
    fileName: `${baseName}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docxBuffer,
  };
  const pdf = pdfBuffer
    ? {
        fileName: `${baseName}.pdf`,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      }
    : null;

  return {
    fileName: pdf?.fileName || docx.fileName,
    mimeType: pdf?.mimeType || docx.mimeType,
    buffer: pdf?.buffer || docx.buffer,
    docxBuffer,
    pdf,
    docx,
  };
}
