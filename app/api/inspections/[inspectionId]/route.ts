import { NextResponse } from "next/server";
import { requireCompanyInspection, requireInspectionWorkspace } from "../../../../lib/inspection/auth";
import { serializeInspection } from "../../../../lib/inspection/service";
import { prisma } from "../../../../lib/prisma";
import { createInspectionToken, getInspectionCaptureUrl, getInspectionReportUrl } from "../../../../lib/inspection/urls";
import { sendInspectionCaptureInviteEmail } from "../../../../lib/inspection/mailer";

export const dynamic = "force-dynamic";

type Ctx = { params: { inspectionId: string } };

export async function GET(_request: Request, context: Ctx) {
  const auth = await requireInspectionWorkspace();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, message: auth.error }, { status: auth.status });
  }

  const inspection = await requireCompanyInspection(context.params.inspectionId, auth.companyId);
  if (!inspection) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    inspection: serializeInspection(inspection, { includeTokens: true }),
  });
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await requireInspectionWorkspace();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, message: auth.error }, { status: auth.status });
  }

  const existing = await requireCompanyInspection(context.params.inspectionId, auth.companyId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  let body: {
    action?: string;
    partComments?: Array<{ partId: string; adminComment: string }>;
    inviteName?: string;
    inviteEmail?: string;
    signature?: { role: "TENANT" | "AGENT" | "OTHER"; name: string; imageDataUrl: string };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "save_comments" && Array.isArray(body.partComments)) {
      for (const item of body.partComments) {
        if (!item?.partId) continue;
        const part = existing.areas.flatMap((a) => a.parts).find((p) => p.id === item.partId);
        if (!part) continue;
        await prisma.inspectionPart.update({
          where: { id: item.partId },
          data: { adminComment: item.adminComment ?? "" },
        });
      }
      if (existing.status === "SUBMITTED") {
        await prisma.inspection.update({
          where: { id: existing.id },
          data: { status: "IN_REVIEW" },
        });
      }
    }

    if (body.action === "add_signature" && body.signature) {
      const imageDataUrl = body.signature.imageDataUrl?.trim() || "";
      const name = body.signature.name?.trim() || "";
      if (!imageDataUrl.startsWith("data:image/") || !name) {
        return NextResponse.json({ ok: false, message: "Signature name and image are required." }, { status: 400 });
      }
      await prisma.inspectionSignature.create({
        data: {
          inspectionId: existing.id,
          role: body.signature.role || "AGENT",
          name,
          imageDataUrl,
        },
      });
      if (existing.status === "SUBMITTED") {
        await prisma.inspection.update({
          where: { id: existing.id },
          data: { status: "IN_REVIEW" },
        });
      }
    }

    if (body.action === "complete") {
      const reportToken = existing.reportToken || createInspectionToken();
      await prisma.inspection.update({
        where: { id: existing.id },
        data: {
          status: "COMPLETED",
          reportToken,
          completedAt: new Date(),
        },
      });
    }

    if (body.action === "send_invite") {
      const inviteEmail = (body.inviteEmail || existing.inviteEmail || "").trim().toLowerCase();
      const inviteName = (body.inviteName || existing.inviteName || existing.tenantName || "").trim();
      if (!inviteEmail) {
        return NextResponse.json({ ok: false, message: "Email is required." }, { status: 400 });
      }
      await prisma.inspection.update({
        where: { id: existing.id },
        data: { inviteEmail, inviteName },
      });
      const emailResult = await sendInspectionCaptureInviteEmail({
        to: inviteEmail,
        name: inviteName || "there",
        propertyName: existing.propertyName,
        tenantName: existing.tenantName,
        captureUrl: getInspectionCaptureUrl(existing.captureToken),
        inspectionId: existing.id,
      });
      const refreshed = await requireCompanyInspection(existing.id, auth.companyId);
      return NextResponse.json({
        ok: true,
        emailResult,
        inspection: refreshed ? serializeInspection(refreshed, { includeTokens: true }) : null,
        captureUrl: getInspectionCaptureUrl(existing.captureToken),
      });
    }

    const refreshed = await requireCompanyInspection(existing.id, auth.companyId);
    return NextResponse.json({
      ok: true,
      inspection: refreshed ? serializeInspection(refreshed, { includeTokens: true }) : null,
      reportUrl: refreshed?.reportToken ? getInspectionReportUrl(refreshed.reportToken) : null,
    });
  } catch (error) {
    console.error("[inspections] patch failed", error);
    return NextResponse.json({ ok: false, message: "Could not update inspection" }, { status: 500 });
  }
}
