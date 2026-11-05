import { NextResponse } from "next/server";
import { findInspectionByReportToken } from "../../../../../../lib/inspection/auth";
import { serializeInspection } from "../../../../../../lib/inspection/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

export async function GET(_request: Request, context: Ctx) {
  const inspection = await findInspectionByReportToken(context.params.token);
  if (!inspection || inspection.status !== "COMPLETED" || !inspection.reportToken) {
    return NextResponse.json({ ok: false, message: "Report not available" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    inspection: serializeInspection(inspection, {
      includeTokens: false,
      photoToken: inspection.reportToken,
    }),
  });
}
