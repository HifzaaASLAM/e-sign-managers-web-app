"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  MoreHorizontal,
  Search,
} from "lucide-react";

export type InspectionListRow = {
  id: string;
  type: string;
  status: string;
  tenantName: string;
  propertyName: string;
  scheduledAt: string | null;
  createdAt: string;
  captureUrl: string | null;
  reportUrl: string | null;
};

const PAGE_SIZE = 10;

const COLORS = {
  scheduled: "#3b82f6",
  inProgress: "#f59e0b",
  completed: "#22c55e",
};

type Bucket = "scheduled" | "inProgress" | "completed";

function bucketForStatus(status: string): Bucket {
  if (status === "COMPLETED") return "completed";
  if (status === "SUBMITTED" || status === "IN_REVIEW") return "inProgress";
  return "scheduled";
}

function displayStatus(status: string) {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "SUBMITTED":
      return "SUBMITTED";
    case "IN_REVIEW":
      return "IN REVIEW";
    case "AWAITING_CAPTURE":
      return "SCHEDULED";
    case "DRAFT":
      return "DRAFT";
    default:
      return status.toUpperCase();
  }
}

function statusDotColor(status: string) {
  const bucket = bucketForStatus(status);
  if (bucket === "completed") return "bg-emerald-500";
  if (bucket === "inProgress") return "bg-amber-500";
  return "bg-blue-500";
}

function typeLabel(type: string) {
  switch (type) {
    case "ENTRY":
      return "Entry inspection";
    case "ROUTINE":
      return "Routine inspection";
    case "EXIT":
      return "Exit inspection";
    default:
      return type;
  }
}

function formatLongDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function exportCsv(rows: InspectionListRow[]) {
  const header = ["Property", "Tenant", "Type", "Status", "Scheduled", "Created", "Report URL"];
  const lines = rows.map((row) =>
    [
      row.propertyName,
      row.tenantName,
      row.type,
      row.status,
      row.scheduledAt || "",
      row.createdAt,
      row.reportUrl || "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "inspections.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function InspectionSummaryCard({ inspections }: { inspections: InspectionListRow[] }) {
  const totals = useMemo(() => {
    let scheduled = 0;
    let inProgress = 0;
    let completed = 0;
    for (const row of inspections) {
      const bucket = bucketForStatus(row.status);
      if (bucket === "scheduled") scheduled += 1;
      else if (bucket === "inProgress") inProgress += 1;
      else completed += 1;
    }
    return { scheduled, inProgress, completed, total: inspections.length };
  }, [inspections]);

  const total = Math.max(totals.total, 1);
  const scheduledPct = (totals.scheduled / total) * 100;
  const inProgressPct = (totals.inProgress / total) * 100;
  const completedPct = (totals.completed / total) * 100;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-700">All inspections</p>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {totals.total === 0 ? (
              <div className="h-full w-full bg-slate-200" />
            ) : (
              <>
                {scheduledPct > 0 ? (
                  <div className="h-full" style={{ width: `${scheduledPct}%`, background: COLORS.scheduled }} />
                ) : null}
                {inProgressPct > 0 ? (
                  <div className="h-full" style={{ width: `${inProgressPct}%`, background: COLORS.inProgress }} />
                ) : null}
                {completedPct > 0 ? (
                  <div className="h-full" style={{ width: `${completedPct}%`, background: COLORS.completed }} />
                ) : null}
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {totals.total} inspection{totals.total === 1 ? "" : "s"} in total
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-3 text-sm lg:w-48">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.scheduled }} />
              SCHEDULED
            </span>
            <strong className="tabular-nums text-slate-900">{totals.scheduled}</strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.inProgress }} />
              IN PROGRESS
            </span>
            <strong className="tabular-nums text-slate-900">{totals.inProgress}</strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.completed }} />
              COMPLETED
            </span>
            <strong className="tabular-nums text-slate-900">{totals.completed}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InspectionsClient({ inspections }: { inspections: InspectionListRow[] }) {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inspections.filter((row) => {
      if (typeFilter !== "ALL" && row.type !== typeFilter) return false;
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.propertyName.toLowerCase().includes(q)
        || row.tenantName.toLowerCase().includes(q)
        || row.type.toLowerCase().includes(q)
        || row.status.toLowerCase().includes(q)
      );
    });
  }, [inspections, typeFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filtersActive = typeFilter !== "ALL" || statusFilter !== "ALL";

  return (
    <div className="space-y-6">
      <InspectionSummaryCard inspections={inspections} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <span className="text-slate-500">Type:</span>
            <select
              className="bg-transparent text-sm font-medium text-slate-800 outline-none"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All</option>
              <option value="ENTRY">Entry</option>
              <option value="ROUTINE">Routine</option>
              <option value="EXIT">Exit</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <span className="text-slate-500">Status:</span>
            <select
              className="bg-transparent text-sm font-medium text-slate-800 outline-none"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All</option>
              <option value="AWAITING_CAPTURE">Scheduled</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="IN_REVIEW">In review</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-0 self-end sm:self-auto">
          <Link
            href="/dashboard/inspections/new"
            className="rounded-l-md bg-[#1677ff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]"
          >
            New Entry Inspection
          </Link>
          <button
            type="button"
            className="rounded-r-md border border-l-0 border-[#1677ff] bg-[#1677ff] px-2 py-2.5 text-white hover:bg-[#1466e6]"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Inspections</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500 sm:w-40"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`rounded-md border p-2 ${showFilters || filtersActive ? "border-blue-500 bg-blue-50 text-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              aria-label="Filter"
            >
              <Filter className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Date range"
            >
              <Calendar className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => exportCsv(filtered)}
              className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Export"
            >
              <Download className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1 text-sm text-slate-500">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[2rem] text-center">{safePage}</span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded p-1 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {showFilters ? (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="ALL">All</option>
                <option value="ENTRY">Entry</option>
                <option value="ROUTINE">Routine</option>
                <option value="EXIT">Exit</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="ALL">All</option>
                <option value="AWAITING_CAPTURE">Scheduled</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="IN_REVIEW">In review</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("ALL");
                setStatusFilter("ALL");
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
            >
              Clear
            </button>
          </div>
        ) : null}

        {pageRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            {inspections.length === 0
              ? "No inspections yet. Create an entry inspection to get started."
              : "No inspections match your search or filters."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pageRows.map((row) => {
              const scheduledLabel = formatLongDate(row.scheduledAt);
              const createdLabel = formatLongDate(row.createdAt);
              return (
                <li key={row.id} className="group px-4 py-4 hover:bg-slate-50/80">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                      <div className="shrink-0 sm:w-28">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                          <span className={`h-2 w-2 rounded-full ${statusDotColor(row.status)}`} />
                          {displayStatus(row.status)}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/dashboard/inspections/${row.id}`}
                          className="font-semibold leading-snug text-slate-900 hover:text-blue-700 hover:underline"
                        >
                          {row.propertyName}
                        </Link>
                        <p className="mt-0.5 text-sm text-slate-500">{typeLabel(row.type)}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                            <Check className="h-3 w-3" strokeWidth={3} />
                          </span>
                          <span>{row.tenantName}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            Tenant
                          </span>
                        </div>

                        <div className="mt-2 space-y-0.5 text-xs text-teal-700/80">
                          {scheduledLabel ? <p>Scheduled · {scheduledLabel}</p> : null}
                          {createdLabel ? <p>Created · {createdLabel}</p> : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 lg:justify-end">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.reportUrl && row.status === "COMPLETED" ? (
                          <a
                            href={row.reportUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Open report
                          </a>
                        ) : null}
                        {row.captureUrl && row.status === "AWAITING_CAPTURE" ? (
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            onClick={() => navigator.clipboard.writeText(row.captureUrl || "")}
                          >
                            Copy link
                          </button>
                        ) : null}
                        <Link
                          href={`/dashboard/inspections/${row.id}`}
                          className="rounded-md bg-[#1677ff] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1466e6]"
                        >
                          Open
                        </Link>
                      </div>
                      <time className="text-sm text-slate-500 tabular-nums">{formatShortDate(row.createdAt)}</time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
