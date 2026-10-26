"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  documentId: string;
  format: "pdf" | "docx";
};

export function DashboardDocumentPreviewFrame({ documentId, format }: Props) {
  const docxHostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(format === "docx");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (format !== "docx") return;

    const url = `/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=docx`;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        const contentType = res.headers.get("Content-Type") || "";
        if (!res.ok) {
          if (contentType.includes("application/json")) {
            const json = await res.json().catch(() => ({}));
            throw new Error(String(json.message || "Could not load document."));
          }
          throw new Error(`Could not load document (${res.status}).`);
        }
        if (contentType.includes("application/json")) {
          const json = await res.json().catch(() => ({}));
          throw new Error(String(json.message || "No preview file is available yet."));
        }

        const blob = await res.blob();
        if (!blob.size) throw new Error("Document file is empty.");
        if (cancelled || !docxHostRef.current) return;

        const docxPreview = await import("docx-preview");
        const renderAsync = docxPreview.renderAsync ?? docxPreview.default?.renderAsync;
        if (typeof renderAsync !== "function") {
          throw new Error("Document preview viewer failed to load.");
        }
        docxHostRef.current.innerHTML = "";
        await renderAsync(blob, docxHostRef.current, undefined, {
          className: "docx-preview-surface",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Preview failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, format]);

  if (format === "pdf") {
    return (
      <iframe
        title="Document preview"
        src={`/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=pdf`}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
      {loading ? (
        <p className="px-6 py-10 text-center text-sm text-slate-500">Loading preview…</p>
      ) : null}
      {error ? (
        <p className="mx-auto max-w-lg px-6 py-10 text-center text-sm text-red-700">{error}</p>
      ) : null}
      <div
        ref={docxHostRef}
        className="docx-preview-host mx-auto w-full max-w-[920px] bg-white px-2 py-4 shadow-sm md:my-4 md:rounded-lg"
      />
    </div>
  );
}
