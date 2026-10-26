import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { findUserByEmail } from "../../../../lib/local-user";
import { getAppUrl } from "../../../../lib/shm/documents";
import { sendPasswordResetEmail } from "../../../../lib/shm/mailer";

export const dynamic = "force-dynamic";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_OK =
  "If an account exists for that email, we just sent a password reset link. Check your inbox and spam folder.";

function hashToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, message: "A valid email address is required." }, { status: 400 });
    }

    const user = await findUserByEmail(email);

    // Always return the same message to avoid account enumeration.
    if (!user?.password) {
      return NextResponse.json({ ok: true, message: GENERIC_OK });
    }

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + RESET_TTL_MS);
    const identifier = `password-reset:${email}`;

    // Drop any previous unused reset tokens for this email.
    await prisma.verificationToken.deleteMany({ where: { identifier } });

    await prisma.verificationToken.create({
      data: {
        identifier,
        token: tokenHash,
        expires,
      },
    });

    const resetUrl = new URL("/reset-password", getAppUrl());
    resetUrl.searchParams.set("token", rawToken);

    const emailResult = await sendPasswordResetEmail({
      to: email,
      name: user.name || undefined,
      resetUrl: resetUrl.toString(),
    });

    if (!emailResult.ok) {
      await prisma.verificationToken.deleteMany({ where: { identifier, token: tokenHash } });
      return NextResponse.json(
        {
          ok: false,
          message: emailResult.message || "Could not send the reset email. Please try again shortly.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, message: GENERIC_OK });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset request failed.";
    console.error("[api/auth/forgot-password]", message);
    return NextResponse.json({ ok: false, message: "Could not start password reset. Please try again." }, { status: 500 });
  }
}
