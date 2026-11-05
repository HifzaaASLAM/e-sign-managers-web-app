"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  Clock3,
  Copy,
  FileText,
  ImageIcon,
  Link2,
  Send,
} from "lucide-react";
import {
  CreatorSignatureCapture,
  getCreatorSignatureValue,
  type CreatorSignatureMode,
} from "./CreatorSignatureCapture";

type Photo = { id: string; fileName: string; url: string };
type Part = {
  id: string;
  label: string;
  tenantNote: string | null;
  adminComment: string | null;
  photos: Photo[];
};
type Area = {
  id: string;
  label: string;
  tenantNotes: string | null;
  parts: Part[];
};
type Signature = {
  id: string;
  role: string;
  name: string;
  imageDataUrl: string;
  signedAt: string;
};

export type InspectionDetail = {
  id: string;
  type: string;
  status: string;
  tenantName: string;
  propertyName: string;
  scheduledAt: string | null;
  createdAt?: string | null;
  captureUrl: string | null;
  reportUrl: string | null;
  inviteName: string | null;
  inviteEmail: string | null;
  areas: Area[];
  signatures: Signature[];
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#1677ff] focus:ring-1 focus:ring-[#1677ff]";

type TabKey = "rooms" | "share" | "signatures";

function statusLabel(status: string) {
  switch (status) {
    case "AWAITING_CAPTURE":
      return "Awaiting photos";
    case "SUBMITTED":
      return "Submitted";
    case "IN_REVIEW":
      return "In review";
    case "COMPLETED":
      return "Completed";
    default:
      return status;
  }
}

function statusTone(status: string) {
  if (status === "COMPLETED") {
    return {
      badge: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      dot: "bg-emerald-500",
      details: "text-emerald-700",
    };
  }
  if (status === "SUBMITTED" || status === "IN_REVIEW") {
    return {
      badge: "bg-blue-50 text-blue-800 ring-blue-200",
      dot: "bg-blue-500",
      details: "text-blue-700",
    };
  }
  return {
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
    details: "text-amber-800",
  };
}

function formatMetaDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function photoCount(area: Area) {
  return area.parts.reduce((sum, part) => sum + part.photos.length, 0);
}

function PartCard({
  part,
  comment,
  onCommentChange,
  readOnly,
}: {
  part: Part;
  comment: string;
  onCommentChange: (value: string) => void;
  readOnly: boolean;
}) {
  const preview = part.photos.slice(0, 5);
  const extra = Math.max(0, part.photos.length - preview.length);

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{part.label}</h3>
        <span className="shrink-0 rounded-full bg-[#eaf1ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#1677ff]">
          {part.photos.length} photo{part.photos.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 min-h-[72px]">
        {part.photos.length ? (
          <div className="flex flex-wrap gap-2">
            {preview.map((photo) => (
              <a
                key={photo.id}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="relative block h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.fileName} className="h-full w-full object-cover" />
              </a>
            ))}
            {extra > 0 ? (
              <a
                href={part.photos[0]?.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-600"
              >
                +{extra}
              </a>
            ) : null}
          </div>
        ) : (
          <div className="flex h-[72px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              No photos for this item
            </span>
          </div>
        )}
      </div>

      {part.tenantNote ? (
        <p className="mt-3 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Tenant:</span> {part.tenantNote}
        </p>
      ) : null}

      <textarea
        className="mt-3 min-h-[72px] w-full flex-1 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#1677ff]"
        placeholder="Add a comment"
        value={comment}
        disabled={readOnly}
        onChange={(e) => onCommentChange(e.target.value)}
      />
    </div>
  );
}

export function InspectionDetailClient({ initial }: { initial: InspectionDetail }) {
  const [inspection, setInspection] = useState(initial);
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const area of initial.areas) {
      for (const part of area.parts) {
        map[part.id] = part.adminComment || "";
      }
    }
    return map;
  });
  const [inviteName, setInviteName] = useState(initial.inviteName || "");
  const [inviteEmail, setInviteEmail] = useState(initial.inviteEmail || "");
  const [sigName, setSigName] = useState("");
  const [sigRole, setSigRole] = useState<"TENANT" | "AGENT" | "OTHER">("AGENT");
  const [sigMode, setSigMode] = useState<CreatorSignatureMode>("draw");
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<TabKey>("rooms");
  const [activeAreaId, setActiveAreaId] = useState(initial.areas[0]?.id || "");

  const awaitingPhotos = inspection.status === "AWAITING_CAPTURE" || inspection.status === "DRAFT";
  const canReview = !awaitingPhotos;
  const tone = statusTone(inspection.status);
  const activeArea = inspection.areas.find((a) => a.id === activeAreaId) || inspection.areas[0] || null;

  const partCommentsPayload = useMemo(
    () => Object.entries(comments).map(([partId, adminComment]) => ({ partId, adminComment })),
    [comments],
  );

  const createdLabel = formatMetaDate(inspection.createdAt);
  const scheduledLabel = formatMetaDate(inspection.scheduledAt);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Update failed");
        setBusy(false);
        return null;
      }
      if (data.inspection) {
        setInspection(data.inspection);
        if (!activeAreaId && data.inspection.areas?.[0]?.id) {
          setActiveAreaId(data.inspection.areas[0].id);
        }
      }
      setBusy(false);
      return data;
    } catch {
      setMessage("Network error");
      setBusy(false);
      return null;
    }
  }

  async function saveComments() {
    const data = await patch({ action: "save_comments", partComments: partCommentsPayload });
    if (data) setMessage("Comments saved.");
  }

  async function sendInvite() {
    const data = await patch({
      action: "send_invite",
      inviteName,
      inviteEmail,
    });
    if (data?.emailResult?.ok) setMessage("Invite email sent.");
    else if (data?.emailResult?.skipped) setMessage(data.emailResult.message || "Email skipped (check RESEND settings).");
    else if (data) setMessage(data.emailResult?.message || "Invite updated.");
  }

  async function addSignature() {
    const imageDataUrl = getCreatorSignatureValue(sigMode, uploadedDataUrl, canvasRef.current);
    if (!imageDataUrl || !sigName.trim()) {
      setMessage("Add a signature name and draw or upload a signature.");
      return;
    }
    const data = await patch({
      action: "add_signature",
      signature: { role: sigRole, name: sigName.trim(), imageDataUrl },
    });
    if (data) {
      setMessage("Signature added.");
      setSigName("");
      setUploadedDataUrl(null);
    }
  }

  async function complete() {
    const data = await patch({ action: "complete" });
    if (data) setMessage("Inspection completed. Report link is ready.");
  }

  async function copyPrimaryLink() {
    const link = inspection.status === "COMPLETED" && inspection.reportUrl
      ? inspection.reportUrl
      : inspection.captureUrl;
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setMessage("Link copied.");
    window.setTimeout(() => setCopied(false), 1600);
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "rooms", label: `Rooms (${inspection.areas.length})` },
    { key: "share", label: "Share link" },
    { key: "signatures", label: "Signatures" },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/inspections"
        className="inline-flex items-center gap-1 text-sm font-medium text-[#1677ff] hover:underline"
      >
        ← All inspections
      </Link>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
                {inspection.propertyName}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {statusLabel(inspection.status)}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              Tenant: {inspection.tenantName} · Entry inspection
              {createdLabel ? ` · Created ${createdLabel}` : ""}
              {scheduledLabel ? ` · Scheduled ${scheduledLabel}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(inspection.captureUrl || inspection.reportUrl) ? (
              <button
                type="button"
                onClick={() => void copyPrimaryLink()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Link2 className="h-4 w-4" />
                {copied ? "Copied" : "Copy link"}
              </button>
            ) : null}
            {inspection.reportUrl ? (
              <a
                href={inspection.reportUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1677ff] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1466e6]"
              >
                <FileText className="h-4 w-4" />
                Open report
              </a>
            ) : null}
          </div>
        </div>

        {canReview ? (
          <>
            <div className="flex gap-5 overflow-x-auto border-b border-slate-200 px-5 sm:px-6">
              {tabs.map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={[
                      "whitespace-nowrap border-b-2 py-3 text-sm font-medium transition",
                      active
                        ? "border-[#1677ff] text-[#1677ff]"
                        : "border-transparent text-slate-500 hover:text-slate-800",
                    ].join(" ")}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {tab === "rooms" && activeArea ? (
              <div className="grid min-h-[520px] lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="border-b border-slate-200 bg-slate-50/70 p-3 lg:border-b-0 lg:border-r">
                  <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Rooms
                  </p>
                  <ul className="space-y-1">
                    {inspection.areas.map((area) => {
                      const active = area.id === activeArea.id;
                      const count = photoCount(area);
                      return (
                        <li key={area.id}>
                          <button
                            type="button"
                            onClick={() => setActiveAreaId(area.id)}
                            className={[
                              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition",
                              active
                                ? "bg-[#eaf1ff] font-semibold text-[#1677ff]"
                                : "text-slate-700 hover:bg-white",
                            ].join(" ")}
                          >
                            <span className="truncate">{area.label}</span>
                            <span
                              className={[
                                "ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                                active ? "bg-[#1677ff] text-white" : "bg-slate-200 text-slate-600",
                              ].join(" ")}
                            >
                              {count}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </aside>

                <div className="p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-slate-900">{activeArea.label}</h2>
                    {inspection.status !== "COMPLETED" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveComments()}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Save comments
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {activeArea.parts.map((part) => (
                      <PartCard
                        key={part.id}
                        part={part}
                        comment={comments[part.id] || ""}
                        readOnly={inspection.status === "COMPLETED"}
                        onCommentChange={(value) =>
                          setComments((prev) => ({ ...prev, [part.id]: value }))
                        }
                      />
                    ))}
                  </div>

                  {inspection.status !== "COMPLETED" ? (
                    <div className="mt-5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void complete()}
                        className="rounded-lg bg-[#1677ff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60"
                      >
                        Mark completed & generate report link
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tab === "share" ? (
              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff] text-[#1677ff]">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Share capture link</h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      The tenant uses this link to upload room photos.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    readOnly
                    className={`${inputClass} font-mono text-xs sm:text-sm`}
                    value={inspection.captureUrl || ""}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!inspection.captureUrl) return;
                      navigator.clipboard.writeText(inspection.captureUrl);
                      setMessage("Capture link copied.");
                    }}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <Copy className="h-4 w-4" />
                    Copy direct link
                  </button>
                </div>

                {inspection.reportUrl ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      readOnly
                      className={`${inputClass} font-mono text-xs sm:text-sm`}
                      value={inspection.reportUrl}
                    />
                    <a
                      href={inspection.reportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#1677ff] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]"
                    >
                      Open report
                    </a>
                  </div>
                ) : null}

                <div className="border-t border-slate-200 pt-5">
                  <h3 className="text-sm font-semibold text-slate-900">Or send it by email</h3>
                  <p className="mt-0.5 text-sm text-slate-500">We&apos;ll email the capture link to this person.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Recipient name</label>
                      <input className={inputClass} value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Recipient email</label>
                      <input
                        type="email"
                        className={inputClass}
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void sendInvite()}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1677ff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    Send to email
                  </button>
                </div>
              </div>
            ) : null}

            {tab === "signatures" ? (
              <div className="space-y-4 p-5 sm:p-6">
                <h2 className="text-base font-semibold text-slate-900">Signatures</h2>
                {inspection.signatures.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {inspection.signatures.map((sig) => (
                      <div key={sig.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="text-sm font-medium">{sig.name} ({sig.role})</p>
                        <p className="text-xs text-slate-400">{new Date(sig.signedAt).toLocaleString()}</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sig.imageDataUrl} alt={`Signature ${sig.name}`} className="mt-2 h-16 w-full object-contain bg-white" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No signatures yet.</p>
                )}

                {inspection.status !== "COMPLETED" ? (
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className={inputClass}
                        placeholder="Signer name"
                        value={sigName}
                        onChange={(e) => setSigName(e.target.value)}
                      />
                      <select
                        className={inputClass}
                        value={sigRole}
                        onChange={(e) => setSigRole(e.target.value as "TENANT" | "AGENT" | "OTHER")}
                      >
                        <option value="AGENT">Agent</option>
                        <option value="TENANT">Tenant</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    <CreatorSignatureCapture
                      canvasRef={canvasRef}
                      mode={sigMode}
                      onModeChange={setSigMode}
                      uploadedDataUrl={uploadedDataUrl}
                      onUploadedDataUrlChange={setUploadedDataUrl}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void addSignature()}
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                    >
                      Add signature
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_280px] sm:p-6">
            <section className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff] text-[#1677ff]">
                  <Link2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Share capture link</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    The tenant uses this link to upload room photos.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  className={`${inputClass} font-mono text-xs sm:text-sm`}
                  value={inspection.captureUrl || ""}
                />
                <button
                  type="button"
                  onClick={() => void copyPrimaryLink()}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied" : "Copy direct link"}
                </button>
              </div>

              <div className="border-t border-slate-200 pt-5">
                <h3 className="text-sm font-semibold text-slate-900">Or send it by email</h3>
                <p className="mt-0.5 text-sm text-slate-500">We&apos;ll email the capture link to this person.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Recipient name</label>
                    <input className={inputClass} value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Recipient email</label>
                    <input
                      type="email"
                      className={inputClass}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendInvite()}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1677ff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Send to email
                </button>
              </div>
            </section>

            <aside className="h-fit rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-base font-semibold text-slate-900">Details</h2>
              <dl className="mt-3 divide-y divide-slate-200 text-sm">
                <div className="flex items-center justify-between gap-3 py-3">
                  <dt className="text-slate-500">Property</dt>
                  <dd className="text-right font-semibold text-slate-900">{inspection.propertyName}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-3">
                  <dt className="text-slate-500">Tenant</dt>
                  <dd className="text-right font-semibold text-slate-900">{inspection.tenantName}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-3">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="text-right font-semibold text-slate-900">Entry</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-3">
                  <dt className="text-slate-500">Status</dt>
                  <dd className={`text-right font-semibold ${tone.details}`}>{statusLabel(inspection.status)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        )}
      </section>

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {awaitingPhotos ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            Waiting for photos to be submitted via the capture link. You can still share or email the link above.
          </p>
        </div>
      ) : null}
    </div>
  );
}
