export default function SignDocumentLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-white">
      <div className="flex flex-col items-center gap-3 text-sm font-semibold text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#f47a21]" />
        Opening document…
      </div>
    </main>
  );
}
