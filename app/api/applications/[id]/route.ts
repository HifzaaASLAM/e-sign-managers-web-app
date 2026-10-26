import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { getApplicationBundle, setApplicationDecision, getApplyUrl } from "../../../../lib/applications/service";
import { APPLICATION_DECISIONS } from "../../../../lib/applications/constants";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_request: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const application = await getApplicationBundle(params.id, company.id);
  if (!application) {
    return NextResponse.json({ ok: false, message: "Application not found" }, { status: 404 });
  }

  const docs = await prisma.shmDocument.findMany({
    where: {
      companyId: company.id,
      documentId: { in: application.documents.map((d) => d.documentId) },
    },
    select: {
      documentId: true,
      status: true,
      recipientName: true,
      recipientEmail: true,
      signedDriveUrl: true,
      signedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    application: {
      ...application,
      applyUrl: application.inviteToken ? getApplyUrl(application.inviteToken) : null,
      documents: application.documents.map((link) => ({
        ...link,
        shm: docs.find((d) => d.documentId === link.documentId) || null,
      })),
    },
    decisions: APPLICATION_DECISIONS,
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const decision = String(body.decisionStatus || body.decision || "").trim();
  if (!decision) {
    return NextResponse.json({ ok: false, message: "decisionStatus is required." }, { status: 400 });
  }

  try {
    const result = await setApplicationDecision(params.id, company.id, decision);
    if (result.count === 0) {
      return NextResponse.json({ ok: false, message: "Application not found" }, { status: 404 });
    }
    const application = await getApplicationBundle(params.id, company.id);
    return NextResponse.json({ ok: true, application });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Update failed" },
      { status: 400 },
    );
  }
}
