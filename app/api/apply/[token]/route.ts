import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { createShmDocument } from "../../../../lib/shm/create-shm-document";
import { linkDocumentToApplication } from "../../../../lib/applications/link";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

export async function GET(_request: Request, { params }: Ctx) {
  const application = await prisma.rentalApplication.findFirst({
    where: { inviteToken: params.token, inviteEnabled: true },
    select: {
      id: true,
      propertyAddress: true,
      title: true,
      decisionStatus: true,
      companyId: true,
    },
  });

  if (!application) {
    return NextResponse.json({ ok: false, message: "Invite link is invalid or disabled." }, { status: 404 });
  }

  if (application.decisionStatus === "Withdrawn" || application.decisionStatus === "Declined") {
    return NextResponse.json({ ok: false, message: "This application is no longer accepting applicants." }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    application: {
      id: application.id,
      propertyAddress: application.propertyAddress,
      title: application.title,
    },
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const application = await prisma.rentalApplication.findFirst({
    where: { inviteToken: params.token, inviteEnabled: true },
  });

  if (!application) {
    return NextResponse.json({ ok: false, message: "Invite link is invalid or disabled." }, { status: 404 });
  }

  if (application.decisionStatus === "Withdrawn" || application.decisionStatus === "Declined") {
    return NextResponse.json({ ok: false, message: "This application is no longer accepting applicants." }, { status: 410 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!name || !email) {
    return NextResponse.json({ ok: false, message: "Name and email are required." }, { status: 400 });
  }

  // Use company owner/admin as the creating user for invite-originated docs.
  const companyUser = await prisma.companyUser.findFirst({
    where: { companyId: application.companyId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  if (!companyUser?.user) {
    return NextResponse.json({ ok: false, message: "Workspace owner unavailable." }, { status: 500 });
  }

  const existingProfile = await prisma.applicantProfile.findUnique({
    where: {
      companyId_email: { companyId: application.companyId, email },
    },
  });

  const created = await createShmDocument({
    companyId: application.companyId,
    user: {
      id: companyUser.user.id,
      name: companyUser.user.name,
      email: companyUser.user.email,
    },
    documentType: "Tenant Application",
    recipientName: name,
    recipientEmail: email,
    recipientRole: "Tenant",
    propertyAddress: application.propertyAddress,
    request,
    rentalApplicationId: application.id,
    applicantProfileId: existingProfile?.id || null,
  });

  await linkDocumentToApplication({
    applicationId: application.id,
    documentId: created.documentId,
    isPrimary: false,
    applicantProfileId: existingProfile?.id || null,
  });

  // Prefill agreementData from reusable profile when available.
  if (existingProfile?.profileData) {
    try {
      const fields = JSON.parse(existingProfile.profileData);
      await prisma.shmDocument.update({
        where: { documentId: created.documentId },
        data: {
          agreementData: JSON.stringify({
            field_values: {
              ...fields,
              e_first: fields.e_first || name.split(/\s+/)[0] || "",
              e_last: fields.e_last || name.split(/\s+/).slice(1).join(" ") || "",
              e_email: email,
              d_addr: application.propertyAddress,
            },
          }),
        },
      });
    } catch {
      // ignore bad profile JSON
    }
  }

  return NextResponse.json({
    ok: true,
    documentId: created.documentId,
    signingUrl: created.signingUrl,
    emailStatus: created.emailStatus,
  });
}
