"use client";

import { FormEvent, useState } from "react";

type ProfileRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  updatedAt: string;
};

export function ProfilesClient({ initialProfiles }: { initialProfiles: ProfileRow[] }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Could not save profile.");
        return;
      }
      const profile = data.profile as ProfileRow & { updatedAt: string };
      setProfiles((prev) => {
        const without = prev.filter((p) => p.id !== profile.id && p.email !== profile.email);
        return [
          {
            id: profile.id,
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            phone: profile.phone,
            updatedAt: profile.updatedAt,
          },
          ...without,
        ];
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setMessage("Profile saved.");
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this applicant profile?")) return;
    const res = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "Could not delete.");
      return;
    }
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
        <input
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[#1677ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60 sm:col-span-2"
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
      </form>

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-500">No profiles yet. Create one or send a Tenant Application.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {profile.firstName} {profile.lastName}
                </p>
                <p className="text-sm text-slate-500">
                  {profile.email}
                  {profile.phone ? ` · ${profile.phone}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(profile.id)}
                className="text-xs font-semibold text-red-600 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
