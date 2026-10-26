"use client";

import { FormEvent, useState } from "react";
import { APPLICATION_DECISIONS } from "../../lib/applications/constants";

type Props = {
  applicationId: string;
  decisionStatus: string;
  readinessScore: number;
  applyUrl: string | null;
  documentId: string;
};

export function ApplicationCampaignPanel({
  applicationId,
  decisionStatus,
  readinessScore,
  applyUrl,
  documentId,
}: Props) {
  const [decision, setDecision] = useState(decisionStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jointName, setJointName] = useState("");
  const [jointEmail, setJointEmail] = useState("");

  async function saveDecision(next: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionStatus: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Could not update decision.");
        return;
      }
      setDecision(next);
      setMessage("Decision updated.");
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function addJoint(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/joint-applicants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: jointName, email: jointEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Could not add joint applicant.");
        return;
      }
      setJointName("");
      setJointEmail("");
      setMessage(`Joint applicant invited (${data.document?.documentId || "created"}).`);
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Rental application campaign</h2>
          <p className="mt-1 text-sm text-slate-700">
            Decision and joint applicants for this Tenant Application ({documentId}).
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-900">Readiness score: {readinessScore}%</p>
        </div>
        {applyUrl ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(applyUrl);
                setMessage("Invite link copied.");
              } catch {
                setMessage(applyUrl);
              }
            }}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            Copy invite link
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {APPLICATION_DECISIONS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={busy}
            onClick={() => saveDecision(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              decision === option
                ? "bg-[#1677ff] text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-white"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <form onSubmit={addJoint} className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          required
          value={jointName}
          onChange={(e) => setJointName(e.target.value)}
          placeholder="Joint applicant name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          value={jointEmail}
          onChange={(e) => setJointEmail(e.target.value)}
          placeholder="Joint applicant email"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Add joint
        </button>
      </form>

      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
    </section>
  );
}
