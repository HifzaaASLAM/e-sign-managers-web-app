"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  documentId: string;
  format: "pdf" | "docx";
};

async function renderDocxPreview(blob: Blob, host: HTMLDivElement) {
  const docxPreview = await import("docx-preview");
  const renderAsync = docxPreview.renderAsync ?? docxPreview.default?.renderAsync;
  if (typeof renderAsync !== "function") {
    throw new Error("Document preview viewer failed to load.");
  }
  host.innerHTML = "";
  await renderAsync(blob, host, undefined, {
    className: "docx-preview-surface",
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    useBase64URL: true,
  });
}

export function DashboardDocumentPreviewFrame({ documentId, format }: Props) {
  const docxHostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"pdf" | "docx" | "loading">(format === "pdf" ? "loading" : "docx");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      setPdfUrl(null);

      try {
        if (format === "pdf") {
          const res = await fetch(
            `/api/dashboard/documents/${encodeURIComponent(documentId)}/file?format=pdf`,
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
          const blob = await res.blob();
          if (!blob.size) throw new Error("Document file is empty.");
          if (cancelled) return;

          // PDF conversion may fall back to DOCX — render accordingly.
          if (contentType.includes("pdf") || blob.type.includes("pdf")) {
            objectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              setPdfUrl(objectUrl);
              setMode("pdf");
            }
            return;
          }

          if (!docxHostRef.current) {
            setMode("docx");
          }
          setMode("docx");
          // Wait a tick so the docx host mounts when switching from loading/pdf.
          await new Promise((r) => setTimeout(r, 0));
          if (cancelled || !docxHostRef.current) return;
          await renderDocxPreview(blob, docxHostRef.current);
          return;
        }

        setMode("docx");
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
        if (cancelled || !docxHostRef.current) return;
        await renderDocxPreview(blob, docxHostRef.current);
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, format]);

  if (mode === "pdf" && pdfUrl) {
    return (
      <iframe
        title="Document preview"
        src={pdfUrl}
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
        className="docx-preview-host mx-auto w-full max-w-[920px] bg-white px-2 py-4 shadow-sm md:my-4 md:rounded-lg [&_.docx-wrapper]:!w-full [&_.docx-wrapper]:!max-w-full [&_table]:!w-full [&_table]:border-collapse [&_td]:!max-w-full [&_td]:align-top [&_td]:break-words"
      />
    </div>
  );
}
