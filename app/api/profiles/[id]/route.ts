import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";

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

  const profile = await prisma.applicantProfile.findFirst({
    where: { id: params.id, companyId: company.id },
  });
  if (!profile) {
    return NextResponse.json({ ok: false, message: "Profile not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, profile });
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

  const existing = await prisma.applicantProfile.findFirst({
    where: { id: params.id, companyId: company.id },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Profile not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const profile = await prisma.applicantProfile.update({
    where: { id: existing.id },
    data: {
      firstName: body.firstName !== undefined ? String(body.firstName).trim() : undefined,
      lastName: body.lastName !== undefined ? String(body.lastName).trim() : undefined,
      phone: body.phone !== undefined ? String(body.phone).trim() || null : undefined,
      profileData:
        body.profileData !== undefined
          ? typeof body.profileData === "string"
            ? body.profileData
            : JSON.stringify(body.profileData)
          : undefined,
    },
  });

  return NextResponse.json({ ok: true, profile });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const existing = await prisma.applicantProfile.findFirst({
    where: { id: params.id, companyId: company.id },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Profile not found" }, { status: 404 });
  }

  await prisma.applicantProfile.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
