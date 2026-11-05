import { findInspectionByReportToken } from "../../../../lib/inspection/auth";
import { serializeInspection } from "../../../../lib/inspection/service";
import { InspectionReportView } from "../../../../components/inspection/InspectionReportView";
import { ensureInspectionSchema } from "../../../../lib/inspection/ensure-schema";
import { getInspectionReportUrl } from "../../../../lib/inspection/urls";

export const dynamic = "force-dynamic";

export default async function InspectReportPage({
  params,
}: {
  params: { token: string };
}) {
  try {
    await ensureInspectionSchema();
  } catch {
    // continue
  }

  const inspection = await findInspectionByReportToken(params.token);

  if (!inspection || inspection.status !== "COMPLETED" || !inspection.reportToken) {
    return (
      <main className="min-h-screen bg-[#eef2f6] px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shm-logo.png" alt="ShareHouse Managers" className="mx-auto h-10 w-auto" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Report not available</h1>
          <p className="mt-2 text-sm text-slate-600">
            This inspection report link is invalid, or the report has not been completed yet.
          </p>
        </div>
      </main>
    );
  }

  const serialized = serializeInspection(inspection, {
    includeTokens: false,
    photoToken: inspection.reportToken,
  });

  return (
    <main className="min-h-screen print:bg-white">
      <InspectionReportView
        inspection={{
          id: serialized.id,
          status: serialized.status === "COMPLETED" ? "Completed" : serialized.status,
          type: serialized.type,
          tenantName: serialized.tenantName,
          propertyName: serialized.propertyName,
          scheduledAt: serialized.scheduledAt,
          submittedAt: serialized.submittedAt,
          completedAt: serialized.completedAt,
          reportUrl: getInspectionReportUrl(inspection.reportToken),
          areas: serialized.areas,
          signatures: serialized.signatures,
        }}
      />
    </main>
  );
}
