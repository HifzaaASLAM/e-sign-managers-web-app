import { cache } from "react";
import { cookies } from "next/headers";
import { getLocalPg, isLocalPgEnabled } from "./local-pg";
import { prisma } from "./prisma";

export type WorkspaceCompany = {
  id: string;
  name: string;
  slug: string;
};

export type WorkspaceMembership = {
  companyUser: {
    id: string;
    companyId: string;
    userId: string;
    role: string;
    createdAt: Date;
  };
  company: WorkspaceCompany;
};

const ROLE_RANK: Record<string, number> = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

function pickPrimaryMembership(
  memberships: WorkspaceMembership[],
  preferredSlug: string | null | undefined,
): WorkspaceMembership | null {
  if (memberships.length === 0) return null;

  if (preferredSlug) {
    const match = memberships.find((m) => m.company.slug === preferredSlug);
    if (match) return match;
  }

  return [...memberships].sort((a, b) => {
    const roleDiff = (ROLE_RANK[a.companyUser.role] ?? 9) - (ROLE_RANK[b.companyUser.role] ?? 9);
    if (roleDiff !== 0) return roleDiff;
    return a.companyUser.createdAt.getTime() - b.companyUser.createdAt.getTime();
  })[0];
}

export async function listWorkspacesForEmail(email: string): Promise<{
  user: { id: string; name: string | null; email: string } | null;
  memberships: WorkspaceMembership[];
}> {
  if (isLocalPgEnabled()) {
    const client = getLocalPg();
    const userResult = await client.query(
      'SELECT id, name, email FROM "User" WHERE email = $1 LIMIT 1',
      [email],
    );
    const user = userResult.rows[0] as { id: string; name: string | null; email: string } | undefined;
    if (!user) return { user: null, memberships: [] };

    const companyUserResult = await client.query(
      `SELECT cu.id, cu."companyId", cu."userId", cu.role::text AS role, cu."createdAt",
              c.id AS "company_id", c.name AS "company_name", c.slug AS "company_slug"
       FROM "CompanyUser" cu
       JOIN "Company" c ON c.id = cu."companyId"
       WHERE cu."userId" = $1
       ORDER BY cu."createdAt" ASC`,
      [user.id],
    );

    const memberships = (companyUserResult.rows as Array<{
      id: string;
      companyId: string;
      userId: string;
      role: string;
      createdAt: string;
      company_id: string;
      company_name: string;
      company_slug: string;
    }>).map((row) => ({
      companyUser: {
        id: row.id,
        companyId: row.companyId,
        userId: row.userId,
        role: row.role,
        createdAt: new Date(row.createdAt),
      },
      company: {
        id: row.company_id,
        name: row.company_name,
        slug: row.company_slug,
      },
    }));

    return { user, memberships };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      companyUsers: {
        include: { company: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user) return { user: null, memberships: [] };

  const memberships: WorkspaceMembership[] = user.companyUsers.map((cu) => ({
    companyUser: {
      id: cu.id,
      companyId: cu.companyId,
      userId: cu.userId,
      role: cu.role,
      createdAt: cu.createdAt,
    },
    company: {
      id: cu.company.id,
      name: cu.company.name,
      slug: cu.company.slug,
    },
  }));

  return {
    user: { id: user.id, name: user.name, email: user.email },
    memberships,
  };
}

async function resolveWorkspaceByEmail(email: string, companySlugOverride?: string | null) {
  let preferredSlug = companySlugOverride;
  if (preferredSlug === undefined) {
    try {
      preferredSlug = (await cookies()).get("shm_workspace")?.value ?? null;
    } catch {
      preferredSlug = null;
    }
  }

  const { user, memberships } = await listWorkspacesForEmail(email);
  if (!user) {
    return { user: null, companyUser: null, company: null, memberships: [] as WorkspaceMembership[] };
  }

  const primary = pickPrimaryMembership(memberships, preferredSlug);
  if (!primary) {
    return { user, companyUser: null, company: null, memberships };
  }

  return {
    user,
    companyUser: primary.companyUser,
    company: primary.company,
    memberships,
  };
}

/** Dedupe workspace DB lookups within a single server request (dashboard page + header). */
export const getWorkspaceByEmail = cache(resolveWorkspaceByEmail);

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date));
}
