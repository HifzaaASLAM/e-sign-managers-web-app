export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <div className="h-5 w-36 animate-pulse rounded bg-slate-200" />
        </div>
      </header>
      <section className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
      </section>
    </main>
  );
}
