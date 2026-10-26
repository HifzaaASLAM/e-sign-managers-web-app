function filenameFromContentDisposition(header: string | null) {
  if (!header) return null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return null;
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted) return quoted[1];
  const plain = header.match(/filename=([^;\s]+)/i);
  return plain ? plain[1].replace(/"/g, "") : null;
}

function ensureDocxFileName(name: string, fallbackFileName: string) {
  const base = (name || fallbackFileName || "Agreement.docx").trim();
  return /\.docx$/i.test(base) ? base : `${base.replace(/\.[^.]+$/, "")}.docx`;
}

export async function downloadDocumentInBrowser(url: string, fallbackFileName: string) {
  const res = await fetch(url, { method: "GET", credentials: "same-origin", redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
    throw new Error("Document is not ready for direct download yet. Please try again shortly.");
  }
  const contentType = res.headers.get("Content-Type") || "";
  if (!res.ok) {
    if (contentType.includes("application/json")) {
      const json = await res.json().catch(() => ({}));
      throw new Error(String(json.message || `Download failed (${res.status}).`));
    }
    throw new Error(`Download failed (${res.status}).`);
  }
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => ({}));
    throw new Error(String(json.message || "No generated file is available yet."));
  }
  if (contentType.includes("text/html")) {
    throw new Error("Could not download the document file. Please refresh and try again.");
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Downloaded file is empty.");
  const head = await blob.slice(0, 64).text();
  if (/<!DOCTYPE|<html/i.test(head)) {
    throw new Error("Could not download the document file. Please refresh and try again.");
  }

  const fileName = ensureDocxFileName(
    filenameFromContentDisposition(res.headers.get("Content-Disposition")) || fallbackFileName,
    fallbackFileName,
  );
  const docxMime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const fileBlob =
    blob.type && !blob.type.includes("html")
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: docxMime });
  const objectUrl = URL.createObjectURL(fileBlob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function dashboardDocumentDownloadFallbackName(documentType: string, documentId: string) {
  const safeType = documentType.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "Document";
  return `${safeType}-${documentId}.docx`;
}
