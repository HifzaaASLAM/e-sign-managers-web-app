import { NextResponse } from "next/server";
import {
  canServeImportedAgreementPreview,
  decodeStoredFileContent,
  getStoredSubmission,
  parseAgreementData,
  pickStoredPreviewFile,
  shouldPreferFreshAgreementPreview,
} from "./document-file";
import { getImportedPdfBuffer } from "../shm/ta-imported-document";
import { applyShmBrandingToImportedPdfBuffer } from "../shm/tenant-agreement-pdf-branding";
import { buildPropertyManagementAgreementDashboardPreview } from "../shm/property-management-agreement-dashboard-preview";
import { buildTenantAgreementDashboardPreview } from "../shm/tenant-agreement-dashboard-preview";
import { isLandlordWeeklyReport, isPropertyManagementAgreement } from "../shm/documents";
import { generateLandlordWeeklyReportFile } from "../shm/landlord-weekly-report-export";
import {
  landlordFromAgreementData,
  rentersFromAgreementData,
} from "../shm/multi-tenant-signatures";

export type DocumentFileSource = {
  agreementData: string | null;
  signedDriveUrl: string | null;
  documentType: string | null;
  documentId: string;
};

async function buildLandlordWeeklyReportPreview(agreementDataRaw: string | null) {
  const agreementData = parseAgreementData(agreementDataRaw);
  if (!agreementData) return null;

  const payload = agreementData.lwr_send_payload as Record<string, unknown> | undefined;
  const payloadReport = (payload?.report_data || {}) as Record<string, unknown>;
  const reportData: Record<string, unknown> = { ...agreementData, ...payloadReport };
  for (const key of ["lwr_send_payload", "lwr_send_job", "last_submission", "send_job", "send_job_payload"]) {
    delete reportData[key];
  }

  const landlordName = String(
    reportData.landlord_name || payload?.landlord_name || "Landlord",
  ).trim();
  if (!landlordName) return null;

  try {
    const generated = await generateLandlordWeeklyReportFile(
      reportData,
      landlordName,
      String(reportData.report_date || ""),
    );
    const buffer = generated.pdf?.buffer?.length ? generated.pdf.buffer : generated.buffer;
    if (!buffer?.length) return null;
    return {
      buffer,
      fileType: "application/pdf",
      fileName: generated.pdf?.fileName || generated.fileName,
    };
  } catch (error) {
    console.error("[document-file] landlord weekly report preview failed", error);
    return null;
  }
}

async function buildInlinePreviewBuffer(
  agreementDataRaw: string | null,
  documentId: string,
  format: "pdf" | "docx",
  documentType?: string | null,
) {
  const agreementData = parseAgreementData(agreementDataRaw);
  if (!agreementData) return null;

  const type = String(documentType || "");
  if (isLandlordWeeklyReport(type) && format === "pdf") {
    return buildLandlordWeeklyReportPreview(agreementDataRaw);
  }

  if (isPropertyManagementAgreement(type)) {
    try {
      const generated = await buildPropertyManagementAgreementDashboardPreview(documentId, "docx");
      if (generated?.buffer.length) return generated;
    } catch (error) {
      console.error("[document-file] property management agreement preview failed", error);
    }
  }

  try {
    const generated = await buildTenantAgreementDashboardPreview(documentId, format);
    if (generated?.buffer.length) {
      return generated;
    }
  } catch (error) {
    console.error("[document-file] tenant agreement dashboard preview failed", error);
  }

  if (canServeImportedAgreementPreview(agreementDataRaw)) {
    const imported = getImportedPdfBuffer(agreementData);
    if (imported) {
      const branded = await applyShmBrandingToImportedPdfBuffer(imported, {
        renters: rentersFromAgreementData(agreementData),
        landlord: landlordFromAgreementData(agreementData),
      });
      return {
        buffer: branded,
        fileType: "application/pdf",
        fileName: "Tenant-Agreement-preview.pdf",
      };
    }
  }

  return null;
}

export async function buildDashboardDocumentFileResponse(
  doc: DocumentFileSource,
  format: "pdf" | "docx",
  asAttachment: boolean,
): Promise<NextResponse> {
  const { agreementData, signedDriveUrl, documentType, documentId } = doc;
  const preferFresh =
    shouldPreferFreshAgreementPreview(agreementData, documentType)
    || isLandlordWeeklyReport(String(documentType || ""));

  function contentDisposition(fileName: string) {
    const safe = fileName.replace(/"/g, "");
    const encoded = encodeURIComponent(fileName);
    return `${asAttachment ? "attachment" : "inline"}; filename="${safe}"; filename*=UTF-8''${encoded}`;
  }

  if (preferFresh) {
    const generated = await buildInlinePreviewBuffer(agreementData, documentId, format, documentType);
    if (generated?.buffer.length) {
      return new NextResponse(new Uint8Array(generated.buffer), {
        status: 200,
        headers: {
          "Content-Type": generated.fileType,
          "Content-Disposition": contentDisposition(generated.fileName),
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          ...(generated.fileType.includes("pdf") ? {} : { "X-SHM-Preview-Format": "docx" }),
        },
      });
    }
  }

  const submission = getStoredSubmission(agreementData);
  const file = submission ? pickStoredPreviewFile(submission, format) : null;
  if (file?.fileContent) {
    const buffer = decodeStoredFileContent(file.fileContent);
    if (buffer.length) {
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": file.fileType,
          "Content-Disposition": contentDisposition(file.fileName),
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      });
    }
  }

  if (!preferFresh) {
    const generated = await buildInlinePreviewBuffer(agreementData, documentId, format, documentType);
    if (generated?.buffer.length) {
      return new NextResponse(new Uint8Array(generated.buffer), {
        status: 200,
        headers: {
          "Content-Type": generated.fileType,
          "Content-Disposition": contentDisposition(generated.fileName),
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      });
    }
  }

  if (signedDriveUrl) {
    if (asAttachment && isPropertyManagementAgreement(documentType || "")) {
      const generated = await buildPropertyManagementAgreementDashboardPreview(documentId, format);
      if (generated?.buffer.length) {
        return new NextResponse(new Uint8Array(generated.buffer), {
          status: 200,
          headers: {
            "Content-Type": generated.fileType,
            "Content-Disposition": contentDisposition(generated.fileName),
            "Cache-Control": "private, no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        });
      }
      return NextResponse.json(
        { message: "No generated file is stored for this document yet." },
        { status: 404 },
      );
    }
    return NextResponse.redirect(signedDriveUrl);
  }

  return NextResponse.json({ message: "No generated file is stored for this document yet." }, { status: 404 });
}
