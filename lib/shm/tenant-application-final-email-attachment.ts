import { convertDocxBufferToPdf } from "./docx-to-pdf";
import { stripDataUri } from "./make";

export type ShmEmailAttachment = {
  fileName: string;
  fileContent: string;
  fileType: string;
};

function isPdfBuffer(buf: Buffer) {
  return buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "%PDF";
}

function buildDocxAttachment(docxSubmission: ShmEmailAttachment): ShmEmailAttachment | null {
  const raw = stripDataUri(docxSubmission.fileContent || "");
  if (!raw) return null;

  try {
    if (!Buffer.from(raw, "base64").length) return null;
  } catch {
    console.error("[tenant-application-final-email] invalid docx base64");
    return null;
  }

  const fileName = docxSubmission.fileName || "Tenant-Application-Approved.docx";
  return {
    fileName,
    fileType:
      docxSubmission.fileType ||
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileContent: raw,
  };
}

/**
 * Final Tenant Application delivery — prefer PDF when conversion works; otherwise stamped DOCX.
 * (PDFShift only converts HTML/URLs, not raw DOCX, so DOCX fallback is required for reliable email.)
 */
export async function buildTenantApplicationFinalPdfAttachments(
  docxSubmission: ShmEmailAttachment,
): Promise<ShmEmailAttachment[]> {
  const docx = buildDocxAttachment(docxSubmission);
  if (!docx) return [];

  const docxBuffer = Buffer.from(docx.fileContent, "base64");

  const pdfBuffer = await convertDocxBufferToPdf(docxBuffer, docx.fileName);
  if (pdfBuffer?.length && isPdfBuffer(pdfBuffer)) {
    const pdfName = docx.fileName
      .replace(/-Approved\.docx$/i, "-Approved.pdf")
      .replace(/\.docx$/i, ".pdf");
    return [
      {
        fileName: pdfName,
        fileType: "application/pdf",
        fileContent: pdfBuffer.toString("base64"),
      },
    ];
  }

  if (pdfBuffer?.length) {
    console.error("[tenant-application-final-email] PDF converter returned non-PDF data; attaching DOCX");
  } else {
    console.error("[tenant-application-final-email] PDF conversion unavailable; attaching DOCX");
  }

  return [docx];
}
