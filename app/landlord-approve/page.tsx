import { LandlordApproveClient } from "../../components/signing/LandlordApproveClient";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: {
    doc_id?: string;
    token?: string;
  };
};

export default function LandlordApprovePage({ searchParams }: Props) {
  const documentId = String(searchParams?.doc_id || "").trim();
  const token = String(searchParams?.token || "").trim();

  if (!documentId || !token) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Invalid link</h1>
          <p className="mt-3 text-sm text-slate-600">
            This landlord approval link is missing required details. Please use the link from your email.
          </p>
        </section>
      </main>
    );
  }

  return <LandlordApproveClient documentId={documentId} token={token} />;
}
