"use client";

import { useState } from "react";

export function WorkspaceMemberInvite({ canInvite }: { canInvite: boolean }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!canInvite) {
    return (
      <p className="text-sm text-slate-500">
        Only workspace owners and admins can invite teammates. Ask an owner to add your work email so everyone sees the same documents and dashboard updates.
      </p>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.message || "Could not add member.");
        return;
      }
      setMessage(data.message || "Member added.");
      setEmail("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3 border-t border-slate-100 pt-6">
      <h2 className="text-lg font-bold text-slate-900">Team access</h2>
      <p className="text-sm text-slate-600">
        Each login has its own workspace until you invite teammates. Add other SHM accounts here so they see the same contracts, audit trail, and send history on{" "}
        <strong>sharehousemanagers.com</strong>.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="colleague@sharehousemanagers.com.au"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#1677ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add to workspace"}
        </button>
      </div>
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
