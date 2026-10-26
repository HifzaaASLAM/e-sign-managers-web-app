"use client";

import { FormEvent, useEffect, useState } from "react";

type TenantSummary = {
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  currentAddress: string;
  occupation: string;
  employer: string;
  salary: string;
  propertyAddress: string;
  rentDisplay: string;
  rentPeriod: string;
  bond: string;
  tenancyStart: string;
  tenancyEnd: string;
  reference1: { name: string; relationship: string; phone: string };
  reference2: { name: string; relationship: string; phone: string };
};

type ReviewPayload = {
  document: {
    documentId: string;
    propertyAddress: string;
    status: string;
  };
  landlord: {
    name: string;
    email: string;
    status: string;
    approvedAt?: string;
  };
  tenant: TenantSummary;
};

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{value}</p>
    </div>
  );
}

export function LandlordApproveClient({
  documentId,
  token,
}: {
  documentId: string;
  token: string;
}) {
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<ReviewPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/shm-docs/tenant-application/landlord-approve?doc_id=${encodeURIComponent(documentId)}&token=${encodeURIComponent(token)}`,
        );
        const json = await res.json();
        if (!res.ok || !json.ok) {
          if (!cancelled) setError(json.message || "Could not load application.");
          return;
        }
        if (!cancelled) setData(json as ReviewPayload);
      } catch {
        if (!cancelled) setError("Network error while loading application.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [documentId, token]);

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (approving) return;
    setApproving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/shm-docs/tenant-application/landlord-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: documentId, token }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || "Could not approve tenant.");
        return;
      }
      setMessage(json.message || "Tenant approved.");
      setData((prev) =>
        prev
          ? {
              ...prev,
              landlord: {
                ...prev.landlord,
                status: "approved",
                approvedAt: new Date().toISOString(),
              },
            }
          : prev,
      );
    } catch {
      setError("Network error while approving.");
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
        <p className="text-sm text-slate-600">Loading tenant application…</p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-16">
        <section className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Unable to open review</h1>
          <p className="mt-3 text-sm text-red-700">{error}</p>
        </section>
      </main>
    );
  }

  if (!data) return null;

  const alreadyApproved = data.landlord.status === "approved";
  const tenant = data.tenant;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10">
      <section className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">ShareHouseManagers</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">Landlord tenant approval</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dear {data.landlord.name}, please review the applicant details below. If you are satisfied,
            approve the tenant to confirm this application.
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p><span className="font-semibold">Document ID:</span> {data.document.documentId}</p>
            <p className="mt-1"><span className="font-semibold">Property:</span> {data.document.propertyAddress || tenant.propertyAddress || "—"}</p>
            <p className="mt-1"><span className="font-semibold">Rent:</span> {tenant.rentDisplay}{tenant.rentPeriod ? ` / ${tenant.rentPeriod}` : ""}</p>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-bold text-slate-950">Applicant details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Detail label="Full name" value={tenant.name} />
              <Detail label="Email" value={tenant.email} />
              <Detail label="Phone" value={tenant.phone} />
              <Detail label="Date of birth" value={tenant.dateOfBirth} />
              <Detail label="Current address" value={tenant.currentAddress} />
              <Detail label="Occupation" value={tenant.occupation} />
              <Detail label="Employer" value={tenant.employer} />
              <Detail label="Income / salary" value={tenant.salary} />
              <Detail label="Bond" value={tenant.bond} />
              <Detail label="Tenancy start" value={tenant.tenancyStart} />
              <Detail label="Tenancy end" value={tenant.tenancyEnd} />
            </div>
          </div>

          {(tenant.reference1.name || tenant.reference2.name) && (
            <div className="mt-8">
              <h2 className="text-lg font-bold text-slate-950">References</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {tenant.reference1.name ? (
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="font-semibold text-slate-900">{tenant.reference1.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{tenant.reference1.relationship || "Reference"}</p>
                    {tenant.reference1.phone ? <p className="mt-1 text-sm text-slate-600">{tenant.reference1.phone}</p> : null}
                  </div>
                ) : null}
                {tenant.reference2.name ? (
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="font-semibold text-slate-900">{tenant.reference2.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{tenant.reference2.relationship || "Reference"}</p>
                    {tenant.reference2.phone ? <p className="mt-1 text-sm text-slate-600">{tenant.reference2.phone}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {error ? <p className="mt-6 text-sm text-red-700">{error}</p> : null}
          {message ? <p className="mt-6 text-sm text-emerald-700">{message}</p> : null}

          {alreadyApproved ? (
            <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Tenant already approved{data.landlord.approvedAt ? ` on ${new Date(data.landlord.approvedAt).toLocaleString()}` : ""}.
            </div>
          ) : (
            <form onSubmit={approve} className="mt-8">
              <button
                type="submit"
                disabled={approving}
                className="w-full rounded-xl bg-[#1677ff] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-[#1466e6] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {approving ? "Approving…" : "Approve the tenant"}
              </button>
              <p className="mt-3 text-center text-xs text-slate-500">
                Approving notifies ShareHouseManagers and the applicant by email.
              </p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
