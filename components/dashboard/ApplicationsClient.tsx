"use client";

import Link from "next/link";
import { useState } from "react";

type ApplicationRow = {
  id: string;
  propertyAddress: string;
  title: string | null;
  decisionStatus: string;
  readinessScore: number;
  applyUrl: string | null;
  documentCount: number;
  primaryDocumentId: string | null;
  createdAt: string;
};

export function ApplicationsClient({ applications }: { applications: ApplicationRow[] }) {
  const [rows, setRows] = useState(applications);
  const [message, setMessage] = useState<string | null>(null);

  async function createInviteOnly() {
    const propertyAddress = window.prompt("Property address for invite-only application?");
    if (!propertyAddress?.trim()) return;
    setMessage(null);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyAddress: propertyAddress.trim(), inviteOnly: true }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setMessage(data.message || "Could not create invite.");
      return;
    }
    setRows((prev) => [
      {
        id: data.application.id,
        propertyAddress: data.application.propertyAddress,
        title: data.application.title,
        decisionStatus: data.application.decisionStatus,
        readinessScore: data.application.readinessScore,
        applyUrl: data.applyUrl,
        documentCount: 0,
        primaryDocumentId: null,
        createdAt: data.application.createdAt,
      },
      ...prev,
    ]);
    setMessage(data.applyUrl ? `Invite ready: ${data.applyUrl}` : "Invite application created.");
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-10 text-center">
        <p className="text-sm text-slate-500">No rental application campaigns yet.</p>
        <button
          type="button"
          onClick={createInviteOnly}
          className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Create invite-to-apply link
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={createInviteOnly}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Create invite-to-apply link
        </button>
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((app) => (
          <li key={app.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{app.title || app.propertyAddress}</p>
              <p className="text-sm text-slate-500">{app.propertyAddress}</p>
              <p className="mt-1 text-xs text-slate-400">
                {app.documentCount} applicant doc{app.documentCount === 1 ? "" : "s"} · Readiness {app.readinessScore}%
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {app.decisionStatus}
              </span>
              {app.applyUrl ? (
                <a
                  href={app.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Invite link
                </a>
              ) : null}
              {app.primaryDocumentId ? (
                <Link
                  href={`/dashboard/documents/${encodeURIComponent(app.primaryDocumentId)}`}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Open
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
