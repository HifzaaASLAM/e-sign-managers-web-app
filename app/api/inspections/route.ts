import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireInspectionWorkspace } from "../../../lib/inspection/auth";
import { createEntryInspection, serializeInspection } from "../../../lib/inspection/service";
import { getInspectionCaptureUrl, getInspectionReportUrl } from "../../../lib/inspection/urls";
import { sendInspectionCaptureInviteEmail } from "../../../lib/inspection/mailer";
import { ensureInspectionSchema } from "../../../lib/inspection/ensure-schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireInspectionWorkspace();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, message: auth.error }, { status: auth.status });
  }

  try {
    await ensureInspectionSchema();
  } catch (error) {
    console.error("[inspections] ensure schema failed", error);
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const where: {
    companyId: string;
    type?: "ENTRY" | "ROUTINE" | "EXIT";
    status?: "DRAFT" | "AWAITING_CAPTURE" | "SUBMITTED" | "IN_REVIEW" | "COMPLETED";
  } = { companyId: auth.companyId };

  if (type === "ENTRY" || type === "ROUTINE" || type === "EXIT") where.type = type;
  if (
    status === "DRAFT"
    || status === "AWAITING_CAPTURE"
    || status === "SUBMITTED"
    || status === "IN_REVIEW"
    || status === "COMPLETED"
  ) {
    where.status = status;
  }

  try {
    const rows = await prisma.inspection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        tenantName: true,
        propertyName: true,
        scheduledAt: true,
        createdAt: true,
        submittedAt: true,
        completedAt: true,
        captureToken: true,
        reportToken: true,
      },
    });

    return NextResponse.json({
      ok: true,
      inspections: rows.map((row) => ({
        ...row,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        submittedAt: row.submittedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        captureUrl: getInspectionCaptureUrl(row.captureToken),
        reportUrl: row.reportToken ? getInspectionReportUrl(row.reportToken) : null,
      })),
    });
  } catch (error) {
    console.error("[inspections] list failed", error);
    return NextResponse.json(
      { ok: false, message: "Inspection tables are not available yet. Run prisma db push." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireInspectionWorkspace();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, message: auth.error }, { status: auth.status });
  }

  try {
    await ensureInspectionSchema();
  } catch (error) {
    console.error("[inspections] ensure schema failed", error);
    return NextResponse.json({ ok: false, message: "Could not prepare inspection tables." }, { status: 503 });
  }

  let body: {
    tenantName?: string;
    propertyName?: string;
    scheduledAt?: string | null;
    bathroomCount?: number;
    bedroomCount?: number;
    inviteName?: string | null;
    inviteEmail?: string | null;
    sendInvite?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  try {
    const inspection = await createEntryInspection({
      companyId: auth.companyId,
      createdById: auth.userId,
      tenantName: body.tenantName || "",
      propertyName: body.propertyName || "",
      scheduledAt: body.scheduledAt,
      bathroomCount: body.bathroomCount,
      bedroomCount: body.bedroomCount,
      inviteName: body.inviteName,
      inviteEmail: body.inviteEmail,
    });

    let emailResult: { ok: boolean; skipped?: boolean; message?: string } | null = null;
    if (body.sendInvite && body.inviteEmail?.trim()) {
      emailResult = await sendInspectionCaptureInviteEmail({
        to: body.inviteEmail.trim(),
        name: body.inviteName?.trim() || body.tenantName || "there",
        propertyName: inspection.propertyName,
        tenantName: inspection.tenantName,
        captureUrl: getInspectionCaptureUrl(inspection.captureToken),
        inspectionId: inspection.id,
      });
    }

    return NextResponse.json({
      ok: true,
      inspection: serializeInspection(inspection, { includeTokens: true }),
      emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create inspection";
    console.error("[inspections] create failed", error);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
