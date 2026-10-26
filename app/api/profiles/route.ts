import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../lib/workspace";
import { profileDataFromFields } from "../../../lib/applications/readiness";

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

  const profiles = await prisma.applicantProfile.findMany({
    where: { companyId: company.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ ok: true, profiles });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { company } = await getWorkspaceByEmail(session.user.email);
  if (!company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const phone = String(body.phone || "").trim() || null;
  const fieldValues = (body.profileData || body.fields || {}) as Record<string, unknown>;

  if (!email || !firstName) {
    return NextResponse.json({ ok: false, message: "Email and first name are required." }, { status: 400 });
  }

  const profileData =
    typeof body.profileData === "string"
      ? body.profileData
      : profileDataFromFields({
          e_first: firstName,
          e_last: lastName,
          e_email: email,
          e_phbh: phone || "",
          ...fieldValues,
        });

  const profile = await prisma.applicantProfile.upsert({
    where: { companyId_email: { companyId: company.id, email } },
    create: {
      companyId: company.id,
      email,
      firstName,
      lastName,
      phone,
      profileData,
    },
    update: {
      firstName,
      lastName,
      phone,
      profileData,
    },
  });

  return NextResponse.json({ ok: true, profile });
}
