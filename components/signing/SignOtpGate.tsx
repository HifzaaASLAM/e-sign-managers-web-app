"use client";

import { FormEvent, useState } from "react";

type Props = {
  documentId: string;
  token: string;
  role?: string;
  recipientEmailMasked?: string;
};

export function SignOtpGate({ documentId, token, role, recipientEmailMasked }: Props) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function sendCode() {
    setSending(true);
    setMessage(null);
    setDevCode(null);
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, token }),
      });
      const data = await res.json();
      setMessage(data.message || (data.ok ? "Code sent." : "Could not send code."));
      if (data.devCode) setDevCode(String(data.devCode));
    } catch {
      setMessage("Network error while sending code.");
    } finally {
      setSending(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, token, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Verification failed.");
        return;
      }
      const params = new URLSearchParams({ doc_id: documentId, token });
      if (role) params.set("role", role);
      window.location.href = `/sign-document?${params.toString()}`;
    } catch {
      setMessage("Network error while verifying.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Secure verification</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter the one-time code sent to your email
          {recipientEmailMasked ? (
            <>
              {" "}
              (<span className="font-medium text-slate-800">{recipientEmailMasked}</span>)
            </>
          ) : null}{" "}
          before opening this tenant application.
        </p>

        <button
          type="button"
          onClick={sendCode}
          disabled={sending}
          className="mt-6 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send verification code"}
        </button>

        <form onSubmit={verify} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            6-digit code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg tracking-[0.35em] outline-none focus:border-blue-500"
              placeholder="••••••"
            />
          </label>
          <button
            type="submit"
            disabled={verifying || code.length < 6}
            className="w-full rounded-xl bg-[#1677ff] px-4 py-3 text-sm font-bold text-white hover:bg-[#1466e6] disabled:opacity-60"
          >
            {verifying ? "Verifying…" : "Continue to application"}
          </button>
        </form>

        {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}
        {devCode ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Dev mode code: <strong>{devCode}</strong>
          </p>
        ) : null}
      </section>
    </main>
  );
}
