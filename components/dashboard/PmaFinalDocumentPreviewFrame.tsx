"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  documentId: string;
  downloadHref?: string | null;
};

/**
 * Loads the final PMA DOCX with the logged-in session (same file as Download / email)
 * and renders it in-browser. Office Online embed cannot fetch our tokenized URLs.
 */
export function PmaFinalDocumentPreviewFrame({ documentId, downloadHref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=docx`,
          { credentials: "same-origin" },
        );
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
        if (cancelled || !hostRef.current) return;

        const docxPreview = await import("docx-preview");
        const renderAsync = docxPreview.renderAsync ?? docxPreview.default?.renderAsync;
        if (typeof renderAsync !== "function") {
          throw new Error("Document preview viewer failed to load.");
        }

        hostRef.current.innerHTML = "";
        await renderAsync(blob, hostRef.current, undefined, {
          // docx-preview passes this to classList.add — must be a single token (no spaces).
          className: "docx-preview-surface",
          inWrapper: true,
          // Complex PMA tables break when forced to Word page widths in HTML.
          ignoreWidth: true,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
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
  }, [documentId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        <span>Final document preview (same DOCX as Download / signer email)</span>
        {downloadHref ? (
          <a href={downloadHref} className="font-semibold text-blue-700 hover:text-blue-900">
            Download Doc
          </a>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading final document…</p>
        ) : null}
        {error ? (
          <div className="mx-auto max-w-lg px-6 py-10 text-center text-sm text-red-700">
            <p>{error}</p>
            {downloadHref ? (
              <p className="mt-3 text-slate-600">
                Open the exact file via{" "}
                <a href={downloadHref} className="font-semibold text-blue-700 hover:underline">
                  Download Doc
                </a>
                .
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          ref={hostRef}
          className="docx-preview-host mx-auto w-full max-w-[960px] bg-white px-3 py-4 shadow-sm md:my-4 md:rounded-lg [&_.docx-wrapper]:!w-full [&_.docx-wrapper]:!max-w-full [&_.docx-wrapper]:!p-4 [&_table]:!w-full [&_table]:border-collapse [&_td]:align-top [&_td]:break-words"
        />
      </div>
    </div>
  );
}
