import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { createShmDocument } from "../../../lib/shm/create-shm-document";
import { createRentalApplication } from "../../../lib/applications/link";
import { getApplyUrl } from "../../../lib/applications/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const applications = await prisma.rentalApplication.findMany({
    where: { companyId: company.id },
    include: {
      documents: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    ok: true,
    applications: applications.map((app) => ({
      ...app,
      applyUrl: app.inviteToken ? getApplyUrl(app.inviteToken) : null,
      documentCount: app.documents.length,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const propertyAddress = String(body.propertyAddress || "").trim();
  const recipientName = String(body.recipientName || "").trim();
  const recipientEmail = String(body.recipientEmail || "").trim().toLowerCase();
  const rentAmount = String(body.rentAmount || "").trim() || undefined;
  const landlordName = String(body.landlordName || "").trim() || undefined;
  const landlordEmail = String(body.landlordEmail || "").trim() || undefined;
  const inviteOnly = Boolean(body.inviteOnly);

  if (!propertyAddress) {
    return NextResponse.json({ ok: false, message: "Property address is required." }, { status: 400 });
  }

  if (inviteOnly) {
    const application = await createRentalApplication({
      companyId: company.id,
      createdById: user.id,
      propertyAddress,
      title: String(body.title || propertyAddress).trim(),
      inviteEnabled: true,
    });
    return NextResponse.json({
      ok: true,
      application,
      applyUrl: application.inviteToken ? getApplyUrl(application.inviteToken) : null,
    });
  }

  if (!recipientName || !recipientEmail) {
    return NextResponse.json({ ok: false, message: "Recipient name and email are required." }, { status: 400 });
  }

  const created = await createShmDocument({
    companyId: company.id,
    user: { id: user.id, name: user.name, email: user.email },
    documentType: "Tenant Application",
    recipientName,
    recipientEmail,
    recipientRole: "Tenant",
    propertyAddress,
    rentAmount,
    landlordName,
    landlordEmail,
    request,
  });

  const link = await prisma.rentalApplicationDocument.findFirst({
    where: { documentId: created.documentId },
    include: { application: true },
  });

  return NextResponse.json({
    ok: true,
    document: created,
    application: link?.application || null,
    applyUrl: link?.application?.inviteToken ? getApplyUrl(link.application.inviteToken) : null,
  });
}
