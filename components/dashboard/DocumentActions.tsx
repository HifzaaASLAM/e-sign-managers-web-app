"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Ban,
  Copy,
  Edit3,
  Eye,
  Download,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  dashboardDocumentDownloadFallbackName,
  downloadDocumentInBrowser,
} from "../../lib/dashboard/download-document-in-browser";
import {
  buildDashboardDocumentDownloadHref,
  buildDashboardDocumentPreviewPageHref,
} from "../../lib/dashboard/document-file";

function ActionBtn({
  icon,
  label,
  onClick,
  href,
  disabled,
  title,
  download,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string | null;
  disabled?: boolean;
  title?: string;
  download?: boolean;
}) {
  const className =
    "inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-blue-700 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:text-slate-400";

  if (href && !disabled) {
    const external =
      !download
      && (href.startsWith("http")
        || href.includes("/api/")
        || href.includes("/sign-document")
        || href.includes("/preview"));
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        download={download ? "" : undefined}
        className={className}
        title={title}
      >
        {icon}
        {label}
      </a>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={className} title={title || (disabled ? "Unavailable" : label)}>
      {icon}
      {label}
    </button>
  );
}

async function postAction(documentId: string, action: string, extra?: Record<string, string>) {
  const res = await fetch(`/api/dashboard/documents/${encodeURIComponent(documentId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || "Action failed.");
  }
  return json as {
    ok: boolean;
    message?: string;
    redirectTo?: string;
    openExternal?: boolean;
    documentId?: string;
    useAction?: string;
  };
}

function StatusBanner({ error, message }: { error: string | null; message: string | null }) {
  if (!error && !message) return null;
  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {error || message}
    </div>
  );
}

function SignerModal({
  title,
  name,
  email,
  role,
  busy,
  onClose,
  onSave,
  setName,
  setEmail,
  setRole,
}: {
  title: string;
  name: string;
  email: string;
  role: string;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setRole: (v: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            Name
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Email
            <input type="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Title / role
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function openUrl(url: string, external: boolean) {
  if (!external) return false;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup || popup.closed) {
    window.location.assign(url);
    return true;
  }
  return false;
}

export function DocumentToolbar({
  documentId,
  status,
  previewUrl,
  filePreviewUrl,
  creatorSigned,
  recipientSigned,
  recipientRemoved,
  recipientEmail,
  recipientName,
  recipientRole,
  onePartyDocument = false,
  reportOnly = false,
}: {
  documentId: string;
  status: string;
  previewUrl: string | null;
  filePreviewUrl: string | null;
  creatorSigned: boolean;
  recipientSigned: boolean;
  recipientRemoved: boolean;
  recipientEmail: string;
  recipientName: string;
  recipientRole: string;
  onePartyDocument?: boolean;
  reportOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(recipientRole || "Tenant");

  const withdrawn = status.toLowerCase() === "withdrawn";
  const signed = status.toLowerCase() === "signed";
  const isDraft = status.toLowerCase() === "draft";
  const viewHref = filePreviewUrl
    ? buildDashboardDocumentPreviewPageHref(documentId)
    : previewUrl;
  const docDownloadHref = filePreviewUrl ? buildDashboardDocumentDownloadHref(documentId) : null;
  const hasActiveUnsignedRecipient =
    !recipientSigned && !recipientRemoved && recipientEmail.includes("@");

  async function onDownloadDoc() {
    if (!docDownloadHref) return;
    setBusy("download");
    setError(null);
    setMessage(null);
    try {
      await downloadDocumentInBrowser(
        docDownloadHref,
        dashboardDocumentDownloadFallbackName("Property Management Agreement", documentId),
      );
      setMessage("Download started.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download document.");
    } finally {
      setBusy(null);
    }
  }

  async function run(action: string, extra?: Record<string, string>) {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const json = await postAction(documentId, action, extra);
      setMessage(json.message || "Done.");
      setShowAdd(false);
      if (json.openExternal && json.redirectTo) {
        const navigatedAway = openUrl(json.redirectTo, true);
        if (navigatedAway) return;
        if (json.documentId) {
          router.push(`/dashboard/documents/${encodeURIComponent(json.documentId)}`);
          return;
        }
      } else if (json.redirectTo) {
        router.push(json.redirectTo);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onAmend() {
    setBusy("amend");
    setError(null);
    setMessage(null);
    try {
      if (withdrawn) throw new Error("Document is withdrawn. Use Clone instead.");

      // One-party forms never use a creator signing page.
      if (onePartyDocument) {
        if (recipientSigned || signed) {
          if (!confirm("Create an amended copy? The original document stays unchanged.")) return;
          await run("amend");
          return;
        }
        const json = await postAction(documentId, "open_amend_or_sign");
        if (json.useAction === "amend") {
          if (!confirm("Create an amended copy? The original document stays unchanged.")) return;
          await run("amend");
          return;
        }
        setMessage(json.message || "Opening…");
        if (json.redirectTo) {
          const navigatedAway = openUrl(json.redirectTo, Boolean(json.openExternal));
          if (navigatedAway) return;
        }
        router.refresh();
        return;
      }

      if (!creatorSigned) {
        const json = await postAction(documentId, "open_amend_or_sign");
        if (json.useAction === "amend") {
          if (!confirm("Creator already signed. Create an amended copy?")) return;
          await run("amend");
          return;
        }
        setMessage(json.message || "Opening…");
        if (json.redirectTo) {
          const navigatedAway = openUrl(json.redirectTo, Boolean(json.openExternal));
          if (navigatedAway) return;
        }
        router.refresh();
        return;
      }
      if (!confirm("Create an amended copy? The original document stays unchanged.")) return;
      await run("amend");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Amend failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <ActionBtn icon={<Edit3 className="h-4 w-4" />} label={busy === "amend" ? "Working…" : "Amend"} disabled={Boolean(busy) || withdrawn} onClick={() => void onAmend()} />
          {!reportOnly ? (
          <ActionBtn
            icon={<UserPlus className="h-4 w-4" />}
            label="Add signer"
            disabled={Boolean(busy) || withdrawn || signed}
            onClick={() => {
              if (hasActiveUnsignedRecipient) {
                setError("This document already has an unsigned recipient. Use Edit to change their details.");
                return;
              }
              setName("");
              setEmail("");
              setRole(recipientRole || "Tenant");
              setShowAdd(true);
            }}
            title={
              signed
                ? "Document already completed"
                : hasActiveUnsignedRecipient
                  ? "Use Edit to change the current recipient"
                  : recipientSigned
                    ? "Invite an additional signer"
                    : "Invite a recipient"
            }
          />
          ) : null}
          <ActionBtn
            icon={<Ban className="h-4 w-4" />}
            label={busy === "withdraw" ? "Working…" : "Withdraw"}
            disabled={Boolean(busy) || withdrawn || signed}
            onClick={() => {
              if (!confirm("Withdraw this document? Signing links will stop working.")) return;
              void run("withdraw");
            }}
          />
          <ActionBtn
            icon={<Copy className="h-4 w-4" />}
            label={busy === "clone" ? "Working…" : "Clone"}
            disabled={Boolean(busy)}
            onClick={() => {
              if (!confirm("Clone this document into a new unsigned copy?")) return;
              void run("clone");
            }}
          />
          <ActionBtn
            icon={<Trash2 className="h-4 w-4" />}
            label={busy === "delete" ? "Removing…" : "Remove"}
            disabled={Boolean(busy)}
            onClick={() => {
              const warn = isDraft
                ? "Remove this draft from the dashboard? This cannot be undone."
                : signed
                  ? "Permanently remove this signed document from the dashboard? This cannot be undone."
                  : "Permanently remove this document from the dashboard? This cannot be undone.";
              if (!confirm(warn)) return;
              void run("delete");
            }}
            title="Remove document from dashboard"
          />
          <ActionBtn icon={<Eye className="h-4 w-4" />} label="View" href={viewHref} disabled={!viewHref} />
        </div>
        <div className="flex items-center gap-5">
          <ActionBtn
            icon={<Download className="h-5 w-5" />}
            label={busy === "download" ? "Downloading…" : "Download Doc"}
            disabled={!docDownloadHref || Boolean(busy)}
            onClick={() => void onDownloadDoc()}
            title="Download agreement document"
          />
          <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to dashboard
          </a>
        </div>
      </div>
      <StatusBanner error={error} message={message} />
      {showAdd && (
        <SignerModal
          title="Add signer"
          name={name}
          email={email}
          role={role}
          busy={Boolean(busy)}
          onClose={() => setShowAdd(false)}
          setName={setName}
          setEmail={setEmail}
          setRole={setRole}
          onSave={() => void run("add_signer", { name, email, role })}
        />
      )}
    </div>
  );
}

export function DocumentSignerActions({
  documentId,
  status,
  recipientSigned,
  recipientEmail,
  recipientName,
  recipientRole,
  recipientStatus,
  canResend,
  signerUrl,
  emailVerifiedLabel,
  nextReminderLabel,
  emailDeliveryLabel,
  emailDeliveryDetail,
  emailDeliveryTone,
  reportOnly = false,
}: {
  documentId: string;
  status: string;
  recipientSigned: boolean;
  recipientEmail: string;
  recipientName: string;
  recipientRole: string;
  recipientStatus: string;
  canResend: boolean;
  signerUrl: string | null;
  emailVerifiedLabel: string;
  nextReminderLabel: string;
  emailDeliveryLabel?: string;
  emailDeliveryDetail?: string;
  emailDeliveryTone?: "ok" | "warn" | "error" | "muted";
  reportOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [name, setName] = useState(recipientName);
  const [email, setEmail] = useState(recipientEmail);
  const [role, setRole] = useState(recipientRole || "Tenant");
  const withdrawn = status.toLowerCase() === "withdrawn";
  const isDraft = status.toLowerCase() === "draft";

  async function run(action: string, extra?: Record<string, string>) {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const json = await postAction(documentId, action, extra);
      setMessage(json.message || "Done.");
      setShowEdit(false);
      if (json.redirectTo) {
        router.push(json.redirectTo);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const dot =
    recipientStatus === "Signed"
      ? "bg-emerald-500 text-white border-emerald-500"
      : recipientStatus === "Viewed" || recipientStatus === "Opened"
        ? "bg-white text-amber-500 border-amber-400"
        : "bg-white text-slate-400 border-slate-300";

  const deliveryBannerClass =
    emailDeliveryTone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : emailDeliveryTone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : emailDeliveryTone === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-slate-200 bg-slate-50 text-slate-800";

  return (
    <div>
      {emailDeliveryLabel ? (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${deliveryBannerClass}`}>
          <p className="font-semibold">{emailDeliveryLabel}</p>
          {emailDeliveryDetail ? <p className="mt-1 leading-relaxed opacity-90">{emailDeliveryDetail}</p> : null}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-950">{recipientName}</h2>
          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 text-[10px] ${dot}`}>
            {recipientStatus === "Signed" ? "✓" : ""}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <ActionBtn
            icon={<Edit3 className="h-4 w-4" />}
            label="Edit"
            disabled={Boolean(busy) || withdrawn || recipientSigned}
            onClick={() => {
              setName(recipientName);
              setEmail(recipientEmail);
              setRole(recipientRole || "Tenant");
              setShowEdit(true);
            }}
          />
          <ActionBtn
            icon={<Trash2 className="h-4 w-4" />}
            label={busy === "delete" || busy === "remove_signer" ? "Removing…" : "Remove"}
            disabled={Boolean(busy) || withdrawn || recipientSigned}
            onClick={() => {
              if (isDraft) {
                if (!confirm("Remove this draft from the dashboard? This cannot be undone.")) return;
                void run("delete");
                return;
              }
              if (!confirm("Remove this recipient from the document?")) return;
              void run("remove_signer");
            }}
          />
        </div>
      </div>

      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <div className="space-y-3 text-sm leading-6">
          <p><span className="font-bold">Name:</span> {recipientName}</p>
          <p><span className="font-bold">Email:</span> {recipientEmail}</p>
          <p><span className="font-bold">Title/company:</span> {recipientRole}</p>
          <p><span className="font-bold">Status:</span> {recipientStatus}</p>
        </div>
        <div className="space-y-3 text-sm leading-6">
          {!reportOnly ? (
            <>
          <p><span className="font-bold">Email address is verified:</span> {emailVerifiedLabel}</p>
          <p><span className="font-bold">Signature request delivery method:</span> Email</p>
          <p><span className="font-bold">Multi factor authentication:</span> -</p>
          <p><span className="font-bold">Next reminder email:</span> {nextReminderLabel}</p>
            </>
          ) : null}
          {!reportOnly && signerUrl && (
            <a href={signerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-slate-900 hover:text-blue-700">
              Show direct link
            </a>
          )}
        </div>
      </div>

      {!reportOnly ? (
      <button
        type="button"
        disabled={Boolean(busy) || !canResend || withdrawn || recipientSigned}
        onClick={() => {
          if (!confirm(`Re-send the signing email to ${recipientEmail}?`)) return;
          void run("resend");
        }}
        className="mt-10 inline-flex items-center gap-2 rounded-md border border-blue-600 px-5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send className="h-4 w-4" />
        {busy === "resend" ? "Sending…" : "Re-send contract"}
      </button>
      ) : null}
      <StatusBanner error={error} message={message} />

      {showEdit && (
        <SignerModal
          title="Edit signer"
          name={name}
          email={email}
          role={role}
          busy={Boolean(busy)}
          onClose={() => setShowEdit(false)}
          setName={setName}
          setEmail={setEmail}
          setRole={setRole}
          onSave={() => void run("update_signer", { name, email, role })}
        />
      )}
    </div>
  );
}
