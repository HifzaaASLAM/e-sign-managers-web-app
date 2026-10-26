"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.message || "Could not send reset email. Please try again.");
        setIsLoading(false);
        return;
      }
      setMessage(data.message || "Check your email for a reset link.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f4f1]">
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <Link href="/login" className="mb-8 inline-flex items-center gap-2">
          <Image src="/shm-logo.png" alt="ShareHouse Managers" width={160} height={40} className="h-9 w-auto" priority />
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold text-slate-950">Reset password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Enter your account email and we will send a secure link to choose a new password.
          </p>
          {sent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {message}
              </div>
              <p className="text-sm text-slate-600">
                Didn’t get it? Check spam, or{" "}
                <button
                  type="button"
                  className="font-semibold text-slate-950 underline-offset-2 hover:underline"
                  onClick={() => {
                    setSent(false);
                    setMessage("");
                  }}
                >
                  try again
                </button>
                .
              </p>
            </div>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block text-[13px] font-semibold text-slate-800">
                Email address
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-900"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>
              {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {isLoading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
          <p className="mt-6 text-sm text-slate-600">
            Remembered it?{" "}
            <Link href="/login" className="font-semibold text-slate-950 underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
