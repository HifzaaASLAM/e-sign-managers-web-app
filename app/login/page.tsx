"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(
          "Invalid email or password, or the session could not be created. Check NEXTAUTH_URL and NEXTAUTH_SECRET.",
        );
        setIsLoading(false);
        return;
      }

      window.location.href = "/dashboard";
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Unknown login error.");
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f4f1]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(245,122,32,0.12),_transparent_45%),radial-gradient(ellipse_at_bottom_right,_rgba(15,23,42,0.06),_transparent_40%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.03)_1px,transparent_1px)] [background-size:28px_28px]"
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6">
        <div className="grid w-full overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] lg:min-h-[640px] lg:grid-cols-2">
          <section className="relative hidden flex-col justify-between bg-slate-950 px-10 py-10 text-white lg:flex xl:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(245,122,32,0.22),_transparent_42%),radial-gradient(circle_at_80%_80%,_rgba(255,255,255,0.06),_transparent_40%)]"
            />
            <Link href="/" className="relative z-10 inline-flex items-center gap-3">
              <Image
                src="/shm-icon.png"
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg"
                priority
              />
              <span className="text-[15px] font-semibold tracking-tight text-white">
                ShareHouse Managers
              </span>
            </Link>

            <div className="relative z-10 max-w-md pb-4">
              <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                Secure workspace
              </p>
              <h1 className="text-[2.65rem] font-semibold leading-[1.12] tracking-tight text-white">
                Access your signing workspace.
              </h1>
              <p className="mt-5 max-w-sm text-[15px] leading-7 text-white/65">
                Sign in to manage documents, send agreements for signature, and track progress from one protected dashboard.
              </p>
            </div>

            <p className="relative z-10 text-xs text-white/35">
              ShareHouseManagers.com.au Pty Ltd
            </p>
          </section>

          <section className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12">
            <div className="mb-8 lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2">
                <Image
                  src="/shm-logo.png"
                  alt="ShareHouse Managers"
                  width={160}
                  height={36}
                  className="h-8 w-auto"
                  priority
                />
              </Link>
            </div>

            <div className="mx-auto w-full max-w-[400px]">
              <h2 className="text-[1.85rem] font-semibold tracking-tight text-slate-950">Sign in</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Use your registered email and password to access the dashboard.
              </p>

              {error ? (
                <div
                  role="alert"
                  className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                >
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="email" className="block text-[13px] font-semibold text-slate-800">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                    placeholder="you@company.com"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="password" className="block text-[13px] font-semibold text-slate-800">
                      Password
                    </label>
                    <Link
                      href="/forgot-password"
                      className="text-[13px] font-medium text-slate-400 transition hover:text-slate-700"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-900/5"
                    placeholder="Enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-1 w-full rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-500">
                No account yet?{" "}
                <Link href="/register" className="font-semibold text-slate-900 underline-offset-2 hover:underline">
                  Create one
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
