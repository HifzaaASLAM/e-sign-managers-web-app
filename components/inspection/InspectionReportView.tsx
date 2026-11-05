"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Copy, Printer } from "lucide-react";
import { STANDARD_PARTS } from "../../lib/inspection/checklist";

type Photo = { id: string; fileName: string; url: string };
type Part = {
  id: string;
  partKey?: string;
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

export type InspectionReportData = {
  id?: string;
  status?: string;
  type?: string;
  tenantName: string;
  propertyName: string;
  scheduledAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  reportUrl?: string | null;
  areas: Area[];
  signatures: Signature[];
};

const PART_COLUMNS = STANDARD_PARTS.map((p) => p.label);

function formatReportDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ReportDocHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-[#f38b3c] pb-4">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shm-logo.png" alt="ShareHouse Managers" className="h-9 w-auto" />
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-slate-900">Entry Inspection Report</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function ReportDocFooter({
  propertyName,
  page,
  total,
}: {
  propertyName: string;
  page: number;
  total: number;
}) {
  return (
    <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-3 text-[11px] text-slate-400">
      <span>ShareHouse Managers · Entry Inspection Report — {propertyName}</span>
      <span>
        Page {page} of {total}
      </span>
    </div>
  );
}

export function InspectionReportView({ inspection }: { inspection: InspectionReportData }) {
  const [copied, setCopied] = useState(false);

  const matrix = useMemo(() => {
    return inspection.areas.map((area, index) => {
      const counts = PART_COLUMNS.map((label) => {
        const part = area.parts.find((p) => p.label.toLowerCase() === label.toLowerCase());
        return part?.photos.length || 0;
      });
      const total = counts.reduce((sum, n) => sum + n, 0);
      return {
        index: index + 1,
        id: area.id,
        label: area.label,
        counts,
        total,
      };
    });
  }, [inspection.areas]);

  const areasWithPhotos = inspection.areas.filter((area) =>
    area.parts.some((part) => part.photos.length > 0),
  );

  const totalPages = 1 + Math.max(1, areasWithPhotos.length > 0 ? 1 : 1);

  async function copyLink() {
    const url = inspection.reportUrl || window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="min-h-screen bg-[#eef2f6] print:bg-white">
      <div className="print:hidden sticky top-0 z-20 border-b border-slate-200 bg-[#1677ff] text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          {inspection.id ? (
            <Link
              href={`/dashboard/inspections/${inspection.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white/95 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to inspection
            </Link>
          ) : (
            <span className="text-sm font-medium text-white/90">Entry Inspection Report</span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/40 bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-[#1677ff] hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:py-8 print:max-w-none print:gap-0 print:px-0 print:py-0">
        {/* Page 1 — Summary */}
        <article className="flex min-h-[900px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:min-h-0 print:rounded-none print:border-0 print:shadow-none print:break-after-page">
          <ReportDocHeader subtitle="Property condition at entry" />

          <div className="mt-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Entry Inspection Report</h1>
            <p className="mt-2 text-sm text-slate-500">
              Record of the property&apos;s condition, supported by tenant photos.
            </p>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-200">
                  <th className="w-1/4 bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Property</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{inspection.propertyName}</td>
                  <th className="w-1/4 bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Status</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{inspection.status || "Completed"}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th className="bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Tenant</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{inspection.tenantName}</td>
                  <th className="bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Inspection type</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">
                    {inspection.type === "ENTRY" || !inspection.type ? "Entry" : inspection.type}
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th className="bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Scheduled</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{formatReportDate(inspection.scheduledAt)}</td>
                  <th className="bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Submitted</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900">{formatReportDate(inspection.submittedAt)}</td>
                </tr>
                <tr>
                  <th className="bg-slate-50 px-3 py-2.5 text-left font-medium text-slate-500">Completed</th>
                  <td className="px-3 py-2.5 font-semibold text-slate-900" colSpan={3}>
                    {formatReportDate(inspection.completedAt)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#1d3557] text-white">
                  <th className="px-3 py-2.5 text-left font-semibold">Room</th>
                  {PART_COLUMNS.map((col) => (
                    <th key={col} className="px-2 py-2.5 text-center font-semibold">
                      {col}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200">
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-800">
                      {String(row.index).padStart(2, "0")} {row.label}
                    </td>
                    {row.counts.map((count, i) => (
                      <td
                        key={`${row.id}-${i}`}
                        className={[
                          "px-2 py-2.5 text-center tabular-nums",
                          count > 0 ? "bg-[#eaf1ff] font-semibold text-[#1677ff]" : "text-slate-400",
                        ].join(" ")}
                      >
                        {count}
                      </td>
                    ))}
                    <td
                      className={[
                        "px-3 py-2.5 text-center tabular-nums font-semibold",
                        row.total > 0 ? "text-slate-900" : "text-slate-400",
                      ].join(" ")}
                    >
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs italic text-slate-400">
            Photo counts reflect images submitted for each room part. Manager comments appear with the photo record.
          </p>

          <ReportDocFooter propertyName={inspection.propertyName} page={1} total={totalPages} />
        </article>

        {/* Page 2 — Photos & signatures */}
        <article className="flex min-h-[900px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:min-h-0 print:rounded-none print:border-0 print:shadow-none">
          <ReportDocHeader subtitle="Photo record & signatures" />

          <div className="mt-8 space-y-8">
            {(areasWithPhotos.length ? areasWithPhotos : inspection.areas.slice(0, 1)).map((area, areaIndex) => {
              const numbered = String(
                inspection.areas.findIndex((a) => a.id === area.id) + 1,
              ).padStart(2, "0");
              const partsWithPhotos = area.parts.filter((p) => p.photos.length > 0);
              const partsWithout = area.parts.filter((p) => p.photos.length === 0).map((p) => p.label);

              return (
                <section key={area.id} className="break-inside-avoid">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-800">
                      {numbered} {area.label} — Photo record
                    </h2>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <div className="mt-4 space-y-5">
                    {partsWithPhotos.map((part) => (
                      <div key={part.id}>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                          {part.label} ({part.photos.length} photo{part.photos.length === 1 ? "" : "s"})
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {part.photos.map((photo, photoIndex) => (
                            <a
                              key={photo.id}
                              href={photo.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photo.url}
                                alt={`${part.label} ${photoIndex + 1}`}
                                className="aspect-square w-full object-cover"
                              />
                              <p className="border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                                {part.label} {photoIndex + 1}
                              </p>
                            </a>
                          ))}
                        </div>
                        {part.adminComment ? (
                          <p className="mt-2 text-xs text-slate-600">
                            <span className="font-semibold">Manager comment:</span> {part.adminComment}
                          </p>
                        ) : null}
                        {part.tenantNote ? (
                          <p className="mt-1 text-xs text-slate-500">
                            <span className="font-semibold">Tenant note:</span> {part.tenantNote}
                          </p>
                        ) : null}
                      </div>
                    ))}

                    {partsWithout.length ? (
                      <p className="text-xs text-slate-400">
                        No photos recorded for {partsWithout.join(", ")}.
                      </p>
                    ) : null}

                    {areaIndex === 0 && partsWithPhotos.length === 0 ? (
                      <p className="text-sm text-slate-400">No photos were submitted for this room.</p>
                    ) : null}
                  </div>
                </section>
              );
            })}

            <section className="break-inside-avoid">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-800">Signatures</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {inspection.signatures.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {inspection.signatures.map((sig) => (
                    <div key={sig.id} className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-900">{sig.name}</p>
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">
                        {sig.role} · {formatReportDate(sig.signedAt)}
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sig.imageDataUrl}
                        alt={`Signature of ${sig.name}`}
                        className="mt-3 h-16 w-full object-contain"
                      />
                      <div className="mt-2 border-t border-slate-200" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">No signatures recorded.</p>
              )}
            </section>
          </div>

          <ReportDocFooter propertyName={inspection.propertyName} page={2} total={totalPages} />
        </article>
      </div>
    </div>
  );
}
