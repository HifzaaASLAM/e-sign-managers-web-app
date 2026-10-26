import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { buildLandlordWeeklyReportTemplateData, generateLandlordWeeklyReportFile } from "../../../../../lib/shm/landlord-weekly-report-export";
import { mapSheetRowToWeeklyReportData } from "../../../../../lib/shm/landlord-weekly-report-make-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const expected = String(process.env.LANDLORD_WEEKLY_REPORT_MAKE_SECRET || "").trim();
  if (!expected) return true;
  const received = String(request.headers.get("x-make-secret") || "").trim();
  return received === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid JSON payload." }, { status: 400 });
  }

  const mapped = mapSheetRowToWeeklyReportData(body as Record<string, unknown>);
  if (!mapped.landlord_email) {
    return NextResponse.json({ message: "landlord_email is required in the webhook payload." }, { status: 400 });
  }

  if (!mapped.landlord_name) {
    return NextResponse.json({ message: "landlord_name is required in the webhook payload." }, { status: 400 });
  }

  try {
    const generated = await generateLandlordWeeklyReportFile(mapped, mapped.landlord_name, mapped.report_date);
    const reportFingerprint = createHash("sha256")
      .update(`${mapped.row_id}:${mapped.landlord_email}:${mapped.report_date}:${mapped.property_name}`)
      .digest("hex")
      .slice(0, 16);

    return NextResponse.json(
      {
        success: true,
        report_id: `lwr_${reportFingerprint}`,
        row_id: mapped.row_id || null,
        landlord: {
          name: mapped.landlord_name,
          email: mapped.landlord_email,
        },
        file: {
          fileName: generated.fileName,
          fileType: generated.mimeType,
          fileContentBase64: generated.buffer.toString("base64"),
        },
        pdf: generated.pdf
          ? {
              fileName: generated.pdf.fileName,
              fileType: generated.pdf.mimeType,
              fileContentBase64: generated.pdf.buffer.toString("base64"),
            }
          : null,
        docx: {
          fileName: generated.docx.fileName,
          fileType: generated.docx.mimeType,
          fileContentBase64: generated.docx.buffer.toString("base64"),
        },
        template_data: buildLandlordWeeklyReportTemplateData(mapped),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate landlord weekly report.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
