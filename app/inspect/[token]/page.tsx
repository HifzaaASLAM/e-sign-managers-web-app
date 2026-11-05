import { findInspectionByCaptureToken } from "../../../lib/inspection/auth";
import { serializeInspection } from "../../../lib/inspection/service";
import { InspectionCaptureClient } from "../../../components/inspection/InspectionCaptureClient";
import { ensureInspectionSchema } from "../../../lib/inspection/ensure-schema";

export const dynamic = "force-dynamic";

export default async function InspectCapturePage({
  params,
}: {
  params: { token: string };
}) {
  try {
    await ensureInspectionSchema();
  } catch {
    // continue
  }

  const inspection = await findInspectionByCaptureToken(params.token);

  if (!inspection) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shm-logo.png" alt="ShareHouse Managers" className="mx-auto h-10 w-auto" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Link not found</h1>
          <p className="mt-2 text-sm text-slate-600">This inspection link is invalid or has expired.</p>
        </div>
      </main>
    );
  }

  const locked = inspection.status === "SUBMITTED"
    || inspection.status === "IN_REVIEW"
    || inspection.status === "COMPLETED";

  const serialized = serializeInspection(inspection, {
    includeTokens: false,
    photoToken: inspection.captureToken,
  });

  return (
    <main className="min-h-screen bg-[#f8fafc] px-4 py-6 sm:py-8">
      <InspectionCaptureClient
        token={params.token}
        initiallyLocked={locked}
        initial={{
          id: serialized.id,
          tenantName: serialized.tenantName,
          propertyName: serialized.propertyName,
          scheduledAt: serialized.scheduledAt,
          status: serialized.status,
          areas: serialized.areas,
        }}
      />
    </main>
  );
}
