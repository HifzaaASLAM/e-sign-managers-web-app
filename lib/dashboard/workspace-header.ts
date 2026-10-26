import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { getWorkspaceByEmail } from "../workspace";

export type DashboardWorkspaceHeaderProps = {
  workspaceName: string | null;
  activeSlug: string;
  workspaces: { slug: string; name: string; role: string }[];
};

export async function getDashboardWorkspaceHeaderProps(): Promise<DashboardWorkspaceHeaderProps | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return null;

  const { company, memberships } = await getWorkspaceByEmail(email);

  return {
    workspaceName: company?.name ?? null,
    activeSlug: company?.slug ?? "",
    workspaces: memberships.map((m) => ({
      slug: m.company.slug,
      name: m.company.name,
      role: m.companyUser.role,
    })),
  };
}
