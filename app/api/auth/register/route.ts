import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../lib/prisma";
import { findUserByEmail } from "../../../../lib/local-user";

export const dynamic = "force-dynamic";

function createSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function getAvailableCompanySlug(companyName: string) {
  const baseSlug = createSlug(companyName) || "workspace";
  let slug = baseSlug;
  let counter = 1;
  while (await prisma.company.findUnique({ where: { slug } })) {
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
  return slug;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const name = String(body?.name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const companyName = String(body?.companyName || "").trim();

    if (!name || !email || !password || !companyName) {
      return NextResponse.json({ ok: false, message: "All fields are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, message: "Password must be at least 8 characters." }, { status: 400 });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ ok: false, message: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const slug = await getAvailableCompanySlug(companyName);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, password: passwordHash },
      });
      const company = await tx.company.create({
        data: { name: companyName, slug },
      });
      await tx.companyUser.create({
        data: { companyId: company.id, userId: user.id, role: "OWNER" },
      });
      return { userId: user.id, companyId: company.id };
    });

    return NextResponse.json({
      ok: true,
      message: "Workspace created.",
      userId: result.userId,
      companyId: result.companyId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed.";
    console.error("[api/auth/register]", message);
    return NextResponse.json({ ok: false, message: "Could not create workspace. Please try again." }, { status: 500 });
  }
}
