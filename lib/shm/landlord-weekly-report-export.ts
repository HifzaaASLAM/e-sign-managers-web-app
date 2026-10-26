import fs from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildLandlordWeeklyReportHtml } from "./landlord-weekly-report-html";
import { renderHtmlToPdf } from "./ownership-statement-export";

function str(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function formatDateAu(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  return raw;
}

export function buildLandlordWeeklyReportTemplateData(data: Record<string, unknown>) {
  const reportWeekStart = formatDateAu(data.report_week_start);
  const reportWeekEnd = formatDateAu(data.report_week_end);

  return {
    property_name: str(data.property_name),
    landlord_name: str(data.landlord_name),
    landlord_email: str(data.landlord_email),
    report_week_start: reportWeekStart,
    report_week_end: reportWeekEnd,
    report_week_range: str(data.report_week_range)
      || (reportWeekStart && reportWeekEnd
        ? `${reportWeekStart} to ${reportWeekEnd}`
        : reportWeekStart || reportWeekEnd),
    report_date: str(data.report_date).includes("/")
      ? str(data.report_date)
      : formatDateAu(data.report_date),
    total_rooms: str(data.total_rooms),
    occupied_rooms: str(data.occupied_rooms),
    vacant_rooms: str(data.vacant_rooms),
    vacant_room_status: str(data.vacant_room_status || data.vacant_rooms_yes_no),
    upcoming_vacancies: str(data.upcoming_vacancies),
    leasing_narrative: str(data.leasing_narrative || data.weekly_update_narrative),
    move_ins_this_week: str(data.move_ins_this_week),
    moving_out: str(data.moving_out),
    vacant_advertised: str(data.vacant_advertised),
    advertising_platform: str(data.advertising_platform),
    enquiries_received: str(data.enquiries_received),
    suitable_enquiries: str(data.suitable_enquiries),
    inspections_arranged: str(data.inspections_arranged),
    applications_received: str(data.applications_received),
    rent_received_week: str(data.rent_received_week),
    new_maintenance_requests: str(data.new_maintenance_requests),
    urgency_level: str(data.urgency_level),
    contractor_contacted: str(data.contractor_contacted),
    quoted: str(data.quoted),
    landlord_approved: str(data.landlord_approved),
    completed_repairs: str(data.completed_repairs),
    final_summary: str(data.final_summary),
    prepared_by: "ShareHouseManagers",
    report_type: "Weekly Landlord Update",
  };
}

async function resolveTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "lib", "shm", "templates", "landlord-weekly-report-template.docx"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "landlord-weekly-report-template.docx"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next location
    }
  }

  throw new Error("Landlord weekly report template file is missing on the server.");
}

export async function generateLandlordWeeklyReportDocx(data: Record<string, unknown>) {
  const templatePath = await resolveTemplatePath();
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  doc.render(buildLandlordWeeklyReportTemplateData(data));
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

const PAGE_HEIGHT = 842;

function wrapLines(font: { widthOfTextAtSize: (text: string, size: number) => number }, text: string, size: number, maxWidth: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfSafe(value: string) {
  return value.replace(/[^\x20-\x7E]/g, " ").trim();
}

async function resolvePdfTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "lib", "shm", "templates", "landlord-weekly-report-template.pdf"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "templates", "landlord-weekly-report-template.pdf"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("Landlord weekly report PDF template is missing.");
}

async function fillLandlordWeeklyReportTemplatePdf(data: Record<string, unknown>) {
  const d = buildLandlordWeeklyReportTemplateData(data);
  const templatePath = await resolvePdfTemplatePath();
  const pdf = await PDFDocument.load(await fs.readFile(templatePath));
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.137, 0.192, 0.247);
  const size = 7;

  const write = (text: string, x: number, top: number) => {
    const value = pdfSafe(text);
    if (!value) return;
    page.drawText(value, {
      x,
      y: PAGE_HEIGHT - top - size,
      size,
      font,
      color,
    });
  };

  const writeWrapped = (text: string, x: number, top: number, maxWidth: number, lineHeight = 8, maxLines = 4) => {
    const lines = wrapLines(font, pdfSafe(text), size, maxWidth).slice(0, maxLines);
    lines.forEach((line, index) => write(line, x, top + index * lineHeight));
  };

  write(d.property_name, 143, 215);
  write(d.landlord_name, 460, 215);
  write(d.report_week_range, 143, 244);
  write(d.report_date, 460, 244);
  write(d.total_rooms, 148, 355);
  write(d.vacant_room_status, 423, 355);
  write(d.vacant_advertised, 259, 428);
  writeWrapped(d.leasing_narrative || d.advertising_platform, 259, 446, 280);
  write(d.enquiries_received, 259, 489);
  write(d.suitable_enquiries, 259, 513);
  write(d.inspections_arranged, 259, 537);
  writeWrapped(d.final_summary, 55, 598, 480, 9, 3);

  return Buffer.from(await pdf.save());
}

async function renderLandlordWeeklyReportPdf(data: Record<string, unknown>) {
  try {
    return await fillLandlordWeeklyReportTemplatePdf(data);
  } catch (error) {
    console.warn("[landlord-weekly-report] PDF template fill failed, using HTML fallback:", error);
  }
  try {
    const html = await buildLandlordWeeklyReportHtml(data);
    return await renderHtmlToPdf(html);
  } catch {
    return null;
  }
}

export type LandlordWeeklyReportGeneratedFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  docx: { fileName: string; mimeType: string; buffer: Buffer };
  pdf: { fileName: string; mimeType: string; buffer: Buffer } | null;
};

export async function generateLandlordWeeklyReportFile(
  data: Record<string, unknown>,
  landlordName: string,
  reportDate?: string,
): Promise<LandlordWeeklyReportGeneratedFile> {
  const safeLandlord = landlordName.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-") || "Landlord";
  const safeProperty = str(data.property_name).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-") || "Property";
  const safeDate = (reportDate || str(data.report_date) || new Date().toISOString().slice(0, 10))
    .replace(/[^\d-]/g, "");
  const baseName = `Landlord-Weekly-Report-${safeProperty}-${safeLandlord}-${safeDate}`;

  let docxBuffer: Buffer | null = null;
  try {
    docxBuffer = await generateLandlordWeeklyReportDocx(data);
  } catch (error) {
    console.warn("[landlord-weekly-report] DOCX generation skipped:", error);
  }

  const pdfBuffer = await renderLandlordWeeklyReportPdf(data);

  const docx = docxBuffer?.length
    ? {
        fileName: `${baseName}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: docxBuffer,
      }
    : null;
  const pdf = pdfBuffer?.length
    ? {
        fileName: `${baseName}.pdf`,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      }
    : null;

  if (!pdf?.buffer?.length && !docx?.buffer?.length) {
    throw new Error(
      "Could not generate the weekly report PDF. Check PDF_API_KEY on the server (same as ownership statements).",
    );
  }

  return {
    fileName: pdf?.fileName || docx!.fileName,
    mimeType: pdf?.mimeType || docx!.mimeType,
    buffer: pdf?.buffer?.length ? pdf.buffer : docx!.buffer,
    docx: docx || {
      fileName: `${baseName}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.alloc(0),
    },
    pdf,
  };
}
