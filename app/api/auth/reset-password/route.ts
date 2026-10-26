import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { updateUserPassword } from "../../../../lib/local-user";

export const dynamic = "force-dynamic";

function hashToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const rawToken = String(body?.token || "").trim();
    const password = String(body?.password || "");
    const confirmPassword = String(body?.confirmPassword || "");

    if (!rawToken) {
      return NextResponse.json({ ok: false, message: "Reset link is missing or invalid." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, message: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ ok: false, message: "Passwords do not match." }, { status: 400 });
    }

    const tokenHash = hashToken(rawToken);
    const record = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });

    if (!record || !record.identifier.startsWith("password-reset:")) {
      return NextResponse.json({ ok: false, message: "This reset link is invalid or has already been used." }, { status: 400 });
    }

    if (record.expires.getTime() < Date.now()) {
      await prisma.verificationToken.delete({ where: { token: tokenHash } }).catch(() => null);
      return NextResponse.json({ ok: false, message: "This reset link has expired. Request a new one." }, { status: 400 });
    }

    const email = record.identifier.slice("password-reset:".length).trim().toLowerCase();
    if (!email.includes("@")) {
      return NextResponse.json({ ok: false, message: "This reset link is invalid." }, { status: 400 });
    }

    const updated = await updateUserPassword(email, password);
    if (!updated) {
      return NextResponse.json({ ok: false, message: "Could not update password for this account." }, { status: 404 });
    }

    await prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } });

    return NextResponse.json({
      ok: true,
      message: "Password updated. You can sign in with your new password.",
      email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset failed.";
    console.error("[api/auth/reset-password]", message);
    return NextResponse.json({ ok: false, message: "Could not reset password. Please try again." }, { status: 500 });
  }
}
