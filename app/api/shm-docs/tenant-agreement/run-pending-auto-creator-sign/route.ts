import { NextResponse } from "next/server";
import { isValidInternalJobSecret } from "../../../../../lib/shm/background-jobs";
import { runDueTenantAgreementAutoCreatorSigns } from "../../../../../lib/shm/tenant-agreement-auto-creator-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Safety net for missed delayed jobs (Hostinger cron or manual trigger). */
export async function POST(request: Request) {
  if (!isValidInternalJobSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const results = await runDueTenantAgreementAutoCreatorSigns(request);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(request: Request) {
  return POST(request);
}
