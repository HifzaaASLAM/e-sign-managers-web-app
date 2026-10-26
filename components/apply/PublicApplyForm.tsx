"use client";

import { FormEvent, useEffect, useState } from "react";

type InviteInfo = {
  id: string;
  propertyAddress: string;
  title: string | null;
};

export function PublicApplyForm({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/apply/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.message || "Invalid invite link.");
          return;
        }
        setInfo(data.application);
      } catch {
        if (!cancelled) setError("Could not load invite.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/apply/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || "Could not start application.");
        return;
      }
      if (data.signingUrl) {
        setDoneUrl(data.signingUrl);
        window.location.href = data.signingUrl;
        return;
      }
      setError("Application created but no signing link was returned.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
        <section className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center">
          <h1 className="text-xl font-bold text-slate-950">Invite unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Invite to apply</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          {info?.title || "Rental application"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Property: <strong>{info?.propertyAddress || "…"}</strong>
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <label className="block text-xs font-semibold text-slate-500">
            Full name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-500">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !info}
            className="w-full rounded-xl bg-[#1677ff] px-4 py-3 text-sm font-bold text-white hover:bg-[#1466e6] disabled:opacity-60"
          >
            {busy ? "Starting…" : doneUrl ? "Opening application…" : "Start application"}
          </button>
        </form>
      </section>
    </main>
  );
}
