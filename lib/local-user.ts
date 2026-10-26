import bcrypt from "bcryptjs";
import { getLocalPg, isLocalPgEnabled } from "./local-pg";
import { prisma } from "./prisma";

export type AuthUserRecord = {
  id: string;
  name: string | null;
  email: string;
  password: string | null;
};

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  if (isLocalPgEnabled()) {
    const client = getLocalPg();
    const result = await client.query(
      'SELECT id, name, email, password FROM "User" WHERE email = $1 LIMIT 1',
      [email]
    );
    return (result.rows[0] as AuthUserRecord | undefined) ?? null;
  }

  return prisma.user.findUnique({ where: { email } });
}

export async function verifyUserPassword(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user?.password) {
    return null;
  }

  const validPassword = await bcrypt.compare(password, user.password);
  return validPassword ? user : null;
}

export async function updateUserPassword(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  if (isLocalPgEnabled()) {
    const client = getLocalPg();
    const result = await client.query(
      'UPDATE "User" SET password = $1, "updatedAt" = NOW() WHERE email = $2 RETURNING id, name, email',
      [passwordHash, normalized],
    );
    return (result.rows[0] as { id: string; name: string | null; email: string } | undefined) ?? null;
  }

  try {
    return await prisma.user.update({
      where: { email: normalized },
      data: { password: passwordHash },
      select: { id: true, name: true, email: true },
    });
  } catch {
    return null;
  }
}
