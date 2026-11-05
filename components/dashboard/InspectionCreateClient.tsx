"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, CalendarDays, Mail } from "lucide-react";

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff] text-[#1677ff]">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-slate-700">
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[#1677ff] focus:ring-1 focus:ring-[#1677ff]";

export function InspectionCreateClient() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [bathroomCount, setBathroomCount] = useState(1);
  const [bedroomCount, setBedroomCount] = useState(1);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantName,
          propertyName,
          scheduledAt: scheduledAt || null,
          bathroomCount,
          bedroomCount,
          inviteName: inviteName || null,
          inviteEmail: inviteEmail || null,
          sendInvite: sendInvite && Boolean(inviteEmail.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.message || "Could not create inspection.");
        setBusy(false);
        return;
      }
      router.push(`/dashboard/inspections/${data.inspection.id}`);
      router.refresh();
    } catch {
      setMessage("Network error creating inspection.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link href="/dashboard/inspections" className="font-medium text-[#1677ff] hover:underline">
          Inspection
        </Link>
        <span className="text-slate-300">›</span>
        <span className="text-slate-500">New entry inspection</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
            New entry inspection
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Add tenant, property, and time. A shareable capture link will be generated.
          </p>
        </div>
        <Link
          href="/dashboard/inspections"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <form
          onSubmit={onSubmit}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="space-y-6 p-5 sm:p-6">
            <section className="space-y-4">
              <SectionHeading
                icon={<Building2 className="h-5 w-5" />}
                title="Tenant & property"
                subtitle="Who is moving in, and where."
              />
              <div>
                <FieldLabel required>Tenant name</FieldLabel>
                <input
                  required
                  className={inputClass}
                  placeholder="e.g. hifza"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Property name / address</FieldLabel>
                <input
                  required
                  className={inputClass}
                  placeholder="e.g. 10/8 Whittlesea - Yea Road, Flowerdale VIC 3717"
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                />
              </div>
            </section>

            <div className="border-t border-slate-200" />

            <section className="space-y-4">
              <SectionHeading
                icon={<CalendarDays className="h-5 w-5" />}
                title="Schedule & rooms"
                subtitle="Room counts decide which rooms get photographed."
              />
              <div>
                <FieldLabel required>Inspection time</FieldLabel>
                <input
                  required
                  type="datetime-local"
                  className={inputClass}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Bathrooms</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    className={inputClass}
                    value={bathroomCount}
                    onChange={(e) => setBathroomCount(Number(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <FieldLabel>Bedrooms</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    className={inputClass}
                    value={bedroomCount}
                    onChange={(e) => setBedroomCount(Number(e.target.value) || 1)}
                  />
                </div>
              </div>
            </section>

            <div className="border-t border-slate-200" />

            <section className="space-y-4">
              <SectionHeading
                icon={<Mail className="h-5 w-5" />}
                title="Optional: email invite"
                subtitle="Send the capture link straight to the tenant."
              />
              <div>
                <FieldLabel>Recipient name</FieldLabel>
                <input
                  className={inputClass}
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Recipient email</FieldLabel>
                <input
                  type="email"
                  className={inputClass}
                  placeholder="name@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1677ff] focus:ring-[#1677ff]"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                />
                <span>Send capture link by email after create</span>
              </label>
            </section>

            {message ? <p className="text-sm text-red-600">{message}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
            <Link
              href="/dashboard/inspections"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-white"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[#1677ff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6] disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create entry inspection"}
            </button>
          </div>
        </form>

        <aside className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">What happens next</h2>
          <ol className="mt-4 space-y-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eaf1ff] text-xs font-bold text-[#1677ff]">
                1
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Capture link generated</p>
                <p className="mt-0.5 text-sm text-slate-500">Unique to this tenant and property.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eaf1ff] text-xs font-bold text-[#1677ff]">
                2
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Share with the tenant</p>
                <p className="mt-0.5 text-sm text-slate-500">Copy the link, or tick the email option.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eaf1ff] text-xs font-bold text-[#1677ff]">
                3
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Room photos come back</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  Review them and open the report from the Inspection list.
                </p>
              </div>
            </li>
          </ol>

          <div className="mt-6 rounded-lg bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Capture link
            </p>
            <div className="mt-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-sm italic text-slate-400">
              Created after you save
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
