import { NextResponse } from "next/server";
import { findInspectionByCaptureToken } from "../../../../../lib/inspection/auth";
import { serializeInspection } from "../../../../../lib/inspection/service";
import { prisma } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

export async function GET(_request: Request, context: Ctx) {
  const inspection = await findInspectionByCaptureToken(context.params.token);
  if (!inspection) {
    return NextResponse.json({ ok: false, message: "Invalid or expired link" }, { status: 404 });
  }

  const locked = inspection.status === "SUBMITTED"
    || inspection.status === "IN_REVIEW"
    || inspection.status === "COMPLETED";

  return NextResponse.json({
    ok: true,
    locked,
    inspection: serializeInspection(inspection, {
      includeTokens: false,
      photoToken: inspection.captureToken,
    }),
  });
}

export async function PATCH(request: Request, context: Ctx) {
  const inspection = await findInspectionByCaptureToken(context.params.token);
  if (!inspection) {
    return NextResponse.json({ ok: false, message: "Invalid or expired link" }, { status: 404 });
  }

  if (inspection.status === "COMPLETED" || inspection.status === "SUBMITTED" || inspection.status === "IN_REVIEW") {
    return NextResponse.json({ ok: false, message: "This inspection has already been submitted." }, { status: 409 });
  }

  let body: {
    action?: string;
    partId?: string;
    tenantNote?: string;
    areaId?: string;
    tenantNotes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "save_part_note" && body.partId) {
    const part = inspection.areas.flatMap((a) => a.parts).find((p) => p.id === body.partId);
    if (!part) {
      return NextResponse.json({ ok: false, message: "Part not found" }, { status: 404 });
    }
    await prisma.inspectionPart.update({
      where: { id: body.partId },
      data: { tenantNote: body.tenantNote ?? "" },
    });
  }

  if (body.action === "save_area_notes" && body.areaId) {
    const area = inspection.areas.find((a) => a.id === body.areaId);
    if (!area) {
      return NextResponse.json({ ok: false, message: "Area not found" }, { status: 404 });
    }
    await prisma.inspectionArea.update({
      where: { id: body.areaId },
      data: { tenantNotes: body.tenantNotes ?? "" },
    });
  }

  if (body.action === "submit") {
    await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });
  }

  const refreshed = await findInspectionByCaptureToken(context.params.token);
  return NextResponse.json({
    ok: true,
    locked: refreshed?.status === "SUBMITTED"
      || refreshed?.status === "IN_REVIEW"
      || refreshed?.status === "COMPLETED",
    inspection: refreshed
      ? serializeInspection(refreshed, {
          includeTokens: false,
          photoToken: refreshed.captureToken,
        })
      : null,
  });
}
