import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { DashboardHeader } from "../../../../components/dashboard/DashboardHeader";
import { InspectionCreateClient } from "../../../../components/dashboard/InspectionCreateClient";

export const dynamic = "force-dynamic";

export default async function NewInspectionPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    if (!company?.id) redirect("/register");
  } catch {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-slate-950">
      <DashboardHeader active="/dashboard/inspections" />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <InspectionCreateClient />
      </section>
    </main>
  );
}
