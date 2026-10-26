import { createHash, randomInt } from "crypto";
import { prisma } from "../prisma";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const COOKIE_PREFIX = "shm_otp_ok_";

export function hashOtpCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function generateOtpCode() {
  return String(randomInt(100000, 999999));
}

export function otpCookieName(documentId: string) {
  return `${COOKIE_PREFIX}${documentId}`;
}

export function buildOtpCookieValue(documentId: string, email: string) {
  return hashOtpCode(`${documentId}:${email.toLowerCase()}:verified`);
}

export function isOtpCookieValid(cookieValue: string | undefined, documentId: string, email: string) {
  if (!cookieValue) return false;
  return cookieValue === buildOtpCookieValue(documentId, email);
}

export async function createOtpChallenge(documentId: string, email: string) {
  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otpChallenge.create({
    data: {
      documentId,
      email: email.toLowerCase(),
      codeHash,
      expiresAt,
    },
  });

  return { code, expiresAt };
}

export async function verifyOtpChallenge(documentId: string, email: string, code: string) {
  const normalizedEmail = email.toLowerCase();
  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      documentId,
      email: normalizedEmail,
      verifiedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return { ok: false as const, message: "No verification code found. Request a new code." };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false as const, message: "Too many attempts. Request a new code." };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, message: "Code expired. Request a new code." };
  }

  const match = challenge.codeHash === hashOtpCode(code.trim());
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: {
      attempts: { increment: 1 },
      ...(match ? { verifiedAt: new Date() } : {}),
    },
  });

  if (!match) {
    return { ok: false as const, message: "Incorrect code. Try again." };
  }

  return {
    ok: true as const,
    cookieValue: buildOtpCookieValue(documentId, normalizedEmail),
  };
}
