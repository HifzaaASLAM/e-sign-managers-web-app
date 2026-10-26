"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  MoreHorizontal,
  Search,
} from "lucide-react";
import type { DashboardDoc } from "../../lib/dashboard/serialize-docs";
import {
  dashboardDocumentDownloadFallbackName,
  downloadDocumentInBrowser,
} from "../../lib/dashboard/download-document-in-browser";
import { buildDashboardDocumentDownloadHref } from "../../lib/dashboard/document-file";
import { SHM_DOCUMENT_TYPES } from "../../lib/shm/documents";
import { ActivityChart } from "./ActivityChart";

type Props = {
  docs: DashboardDoc[];
  activitySeries: import("../../lib/dashboard/serialize-docs").ActivityPoint[];
  activityTotals: { sent: number; viewed: number; signed: number };
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Sent", label: "Sent" },
  { value: "Viewed", label: "Viewed" },
  { value: "Signed", label: "Signed" },
  { value: "Processing", label: "Processing" },
  { value: "Awaiting Creator Signature", label: "Awaiting creator" },
  { value: "Awaiting Recipient Signature", label: "Awaiting recipient" },
  { value: "Withdrawn", label: "Withdrawn / declined" },
  { value: "Make Error", label: "Error" },
];

function displayStatus(status: string) {
  if (status === "Make Error") return "ERROR";
  if (status === "Awaiting Creator Signature") return "AWAITING CREATOR";
  if (status === "Awaiting Signatures") return "AWAITING SIGNATURES";
  if (status === "Awaiting Recipient Signature" || status === "Awaiting Tenant") return "AWAITING RECIPIENT";
  return status.toUpperCase();
}

function recipientEmailHint(doc: DashboardDoc) {
  if (doc.recipient.status === "Signed") return null;
  if (doc.recipient.status === "Email failed") return "Signing email failed — open doc and Re-send";
  if (doc.recipient.status === "Sent" || doc.sentAt) return null;
  const isPma = String(doc.documentType || "").toLowerCase() === "property management agreement";
  if (isPma && doc.status === "Draft") return "Amended — open creator link and Send to Owner";
  const isTa = String(doc.documentType || "").toLowerCase() === "tenant agreement";
  if (isTa) return doc.sentAt ? null : "Signing email not sent — Re-send from document page";
  if (!isPma && doc.creator.status !== "Signed") return null;
  return "Signing email not sent — Re-send from document page";
}

function statusDotColor(status: string) {
  if (status === "Signed") return "bg-emerald-500";
  if (status === "Draft") return "bg-slate-400";
  if (status === "Processing") return "bg-purple-500";
  if (status === "Viewed") return "bg-amber-500";
  if (status === "Withdrawn") return "bg-red-400";
  if (status === "Make Error") return "bg-red-500";
  if (status.includes("Awaiting")) return "bg-orange-500";
  return "bg-blue-500";
}

function signerDone(status: string) {
  return status === "Signed";
}

function signerPending(status: string) {
  return status === "Viewed" || status === "Opened" || status === "Sent";
}

function signerHasViewed(signer: { status: string; viewedAt: string | null }) {
  return Boolean(signer.viewedAt) || signer.status === "Viewed" || signer.status === "Opened";
}

function auditLabelClass(signer: { status: string; viewedAt: string | null }) {
  if (signer.status === "Signed") return "text-emerald-700";
  if (signerHasViewed(signer)) return "text-amber-700";
  return "text-slate-400";
}

function signerEmailIssue(status: string) {
  return status === "Email failed";
}

function PartyIcon({ status, viewedAt }: { status: string; viewedAt?: string | null }) {
  if (signerDone(status)) {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white"
        title="Signed"
      >
        ✓
      </span>
    );
  }
  if (signerEmailIssue(status)) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-red-500 bg-red-50 text-[9px] font-bold text-red-600">
        !
      </span>
    );
  }
  if (signerPending(status)) {
    const viewed = status === "Viewed" || status === "Opened" || Boolean(viewedAt);
    if (viewed) {
      return (
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-50"
          title="Viewed"
        >
          <Eye className="h-3 w-3 text-amber-600" strokeWidth={2.25} aria-hidden />
        </span>
      );
    }
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-white"
        title="Sent — not viewed yet"
      >
        <span className="h-1.5 w-1.5 rounded-full border border-amber-400 bg-transparent" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white" />
  );
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(iso));
}

function exportCsv(rows: DashboardDoc[]) {
  const header = ["Document ID", "Title", "Type", "Status", "Recipient", "Recipient Status", "Creator", "Creator Status", "Property", "Date", "Both Signed", "Final PDF URL"];
  const lines = rows.map((doc) =>
    [
      doc.documentId,
      doc.title,
      doc.documentType,
      doc.status,
      doc.recipient.name,
      doc.recipient.status,
      doc.creator.name,
      doc.creator.status,
      doc.propertyAddress,
      formatShortDate(doc.createdAt),
      doc.bothPartiesSigned ? "Yes" : "No",
      doc.finalPdfUrl || "",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",")
  );
  const blob = new Blob([header.join(",") + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shm-documents-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 10;

export function DashboardContracts({ docs, activitySeries, activityTotals }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(docs[0]?.documentId ?? "");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function onDownloadDoc(doc: DashboardDoc) {
    setDownloadingId(doc.documentId);
    try {
      await downloadDocumentInBrowser(
        buildDashboardDocumentDownloadHref(doc.documentId),
        dashboardDocumentDownloadFallbackName(doc.documentType, doc.documentId),
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not download document.");
    } finally {
      setDownloadingId(null);
    }
  }

  const documentTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const type of SHM_DOCUMENT_TYPES) {
      if (!seen.has(type)) {
        seen.add(type);
        options.push(type);
      }
    }
    for (const doc of docs) {
      const type = String(doc.documentType || "").trim();
      if (type && !seen.has(type)) {
        seen.add(type);
        options.push(type);
      }
    }
    return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [docs]);

  const filtersActive =
    statusFilter !== "all" || documentTypeFilter !== "all" || Boolean(dateFrom) || Boolean(dateTo);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((doc) => {
      if (statusFilter !== "all" && doc.status !== statusFilter) return false;
      if (documentTypeFilter !== "all" && doc.documentType !== documentTypeFilter) return false;
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (new Date(doc.createdAt) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(doc.createdAt) > to) return false;
      }
      if (!q) return true;
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.documentId.toLowerCase().includes(q) ||
        doc.documentType.toLowerCase().includes(q) ||
        doc.propertyAddress.toLowerCase().includes(q) ||
        doc.recipient.name.toLowerCase().includes(q) ||
        doc.creator.name.toLowerCase().includes(q) ||
        doc.recipients.some(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.email.toLowerCase().includes(q) ||
            s.role.toLowerCase().includes(q),
        )
      );
    });
  }, [docs, search, statusFilter, documentTypeFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectedDoc = docs.find((d) => d.documentId === selectedId) ?? docs[0];

  return (
    <div className="space-y-6">
      <ActivityChart series={activitySeries} totals={activityTotals} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          {docs.map((doc) => (
            <option key={doc.documentId} value={doc.documentId}>
              {doc.title}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 items-center gap-0">
          <Link
            href="/dashboard/documents/new"
            className="rounded-l-md bg-[#1677ff] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1466e6]"
          >
            New document
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

      {selectedDoc && (
        <div className="space-y-3">
          <Link
            href={`/dashboard/documents/${encodeURIComponent(selectedDoc.documentId)}`}
            className="block rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:border-blue-300 hover:bg-blue-50/40"
          >
            <span className="font-semibold text-slate-800">{selectedDoc.documentId}</span>
            <span className="mx-2 text-slate-300">·</span>
            {selectedDoc.onePartyDocument
              ? (selectedDoc.recipients.length > 1
                ? selectedDoc.recipients.map((s) => s.name).join(", ")
                : selectedDoc.recipient.name)
              : `${selectedDoc.recipients.length > 1 ? selectedDoc.recipients.map((s) => s.name).join(", ") : selectedDoc.recipient.name} & ${selectedDoc.creator.name}`}
            <span className="mx-2 text-slate-300">·</span>
            {displayStatus(selectedDoc.status)}
          </Link>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Contracts</h2>
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

        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
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
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Document type</label>
              <select
                value={documentTypeFilter}
                onChange={(e) => {
                  setDocumentTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="mt-1 max-w-[14rem] rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="all">All types</option>
                {documentTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setDocumentTypeFilter("all");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
            >
              Clear
            </button>
          </div>
        )}

        {pageRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            {docs.length === 0 ? "No documents yet. Create your first document to get started." : "No contracts match your search or filters."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pageRows.map((doc) => {
              const emailHint = recipientEmailHint(doc);
              return (
              <li key={doc.id} className="group px-4 py-4 hover:bg-slate-50/80">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                    <div className="shrink-0">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                        <span className={`h-2 w-2 rounded-full ${statusDotColor(doc.status)}`} />
                        {displayStatus(doc.status)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/documents/${encodeURIComponent(doc.documentId)}`}
                        className="font-semibold leading-snug text-slate-900 hover:text-blue-700 hover:underline"
                      >
                        {doc.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-400">{doc.documentId}</p>
                      <ul className="mt-3 space-y-1.5">
                        {(doc.recipients.length ? doc.recipients : [doc.recipient]).map((signer, signerIndex) => (
                          <li
                            key={`${doc.documentId}-${signer.email || signer.name}-${signerIndex}`}
                            className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 text-sm text-slate-700"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <PartyIcon status={signer.status} viewedAt={signer.viewedAt} />
                              <span>{signer.name}</span>
                              {signer.email ? (
                                <span className="text-xs text-slate-500">({signer.email})</span>
                              ) : null}
                              {signer.role && (doc.hideCreatorSigner || doc.recipients.length > 1) ? (
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                  {signer.role}
                                </span>
                              ) : null}
                              {signer.status !== "Signed" && signer.status !== "CC" && signer.signingUrl ? (
                                <a
                                  href={signer.signingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Sign
                                </a>
                              ) : null}
                            </div>
                            {signer.auditLabel ? (
                              <p className={`w-full text-xs font-medium sm:pl-7 ${auditLabelClass(signer)}`}>
                                {signer.auditLabel}
                              </p>
                            ) : null}
                            {signerIndex === 0 && emailHint ? (
                              <span className="text-xs font-medium text-amber-700">{emailHint}</span>
                            ) : null}
                          </li>
                        ))}
                        {!doc.onePartyDocument && !doc.hideCreatorSigner && (
                          <li className="flex flex-col gap-0.5 text-sm text-slate-700">
                            <div className="flex flex-wrap items-center gap-2">
                              <PartyIcon status={doc.creator.status} viewedAt={doc.creator.viewedAt} />
                              <span>{doc.creator.name}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Creator</span>
                              {doc.creator.status !== "Signed" && doc.creator.signingUrl && (
                                <a href={doc.creator.signingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                  Sign
                                </a>
                              )}
                            </div>
                            <p className={`text-xs font-medium sm:pl-7 ${auditLabelClass(doc.creator)}`}>
                              {doc.creator.auditLabel}
                            </p>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-4 lg:justify-end">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onDownloadDoc(doc)}
                        disabled={downloadingId === doc.documentId}
                        className="rounded p-1.5 text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
                        title="Download Doc"
                        aria-label="Download Doc"
                      >
                        <Download className="h-5 w-5" />
                      </button>
                      <Link
                        href={`/dashboard/documents/${encodeURIComponent(doc.documentId)}`}
                        className="rounded p-1.5 text-slate-700 hover:bg-slate-100"
                        title="Open document"
                      >
                        <FileText className="h-5 w-5" />
                      </Link>
                    </div>
                    <time className="text-sm text-slate-500 tabular-nums">{formatShortDate(doc.createdAt)}</time>
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
