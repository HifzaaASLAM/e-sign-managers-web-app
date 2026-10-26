import Link from "next/link";

export default function SigningCompletePage() {
  return (
    <main className="min-h-screen bg-[#eef3f7] px-5 py-16">
      <section className="mx-auto max-w-lg rounded-2xl border border-emerald-200 bg-white p-10 text-center shadow-lg">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">
          ✓
        </div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Document signed successfully</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Thank you. Your signature has been recorded. Your signing link has been closed and cannot be used again.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          If someone forwarded this email, their link will not work — only your unique link was valid for signing.
        </p>
        <Link href="/" className="mt-8 inline-flex rounded-lg bg-[#1677ff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]">
          Done
        </Link>
      </section>
    </main>
  );
}
