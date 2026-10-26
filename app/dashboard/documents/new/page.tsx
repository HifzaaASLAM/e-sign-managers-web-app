import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { SendDocumentForm } from "../../../../components/dashboard/SendDocumentForm";
import { DashboardHeader } from "../../../../components/dashboard/DashboardHeader";

export default async function NewShmDocumentPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard/documents/new" />
      <section className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-4xl font-black tracking-tight text-slate-950">Send new document</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            For Property Management Agreements and Tenant Agreements, you preview and edit the document first; the signing email goes out only when you send from the agreement page. Other types email the recipient immediately. Each signing link is single-use.
          </p>
          <SendDocumentForm />
        </div>
      </section>
    </main>
  );
}
