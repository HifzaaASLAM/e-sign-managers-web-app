import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const actorEmail = session?.user?.email?.trim().toLowerCase();
  if (!actorEmail) {
    return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const memberEmail = String(body?.email || "").trim().toLowerCase();
  if (!memberEmail) {
    return NextResponse.json({ ok: false, message: "Email is required." }, { status: 400 });
  }

  const { companyUser, company } = await getWorkspaceByEmail(actorEmail);
  if (!company || !companyUser) {
    return NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  }

  if (companyUser.role !== "OWNER" && companyUser.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only workspace owners/admins can add members." }, { status: 403 });
  }

  const targetUser = await prisma.user.findUnique({ where: { email: memberEmail } });
  if (!targetUser) {
    return NextResponse.json({
      ok: false,
      message: "No account exists for that email. Ask them to register at sharehousemanagers.com/register first.",
    }, { status: 404 });
  }

  const existing = await prisma.companyUser.findUnique({
    where: { companyId_userId: { companyId: company.id, userId: targetUser.id } },
  });
  if (existing) {
    return NextResponse.json({ ok: true, message: "That user is already in this workspace." });
  }

  await prisma.companyUser.create({
    data: {
      companyId: company.id,
      userId: targetUser.id,
      role: "MEMBER",
    },
  });

  return NextResponse.json({
    ok: true,
    message: `${memberEmail} can now switch to workspace “${company.name}” from the dashboard.`,
  });
}
