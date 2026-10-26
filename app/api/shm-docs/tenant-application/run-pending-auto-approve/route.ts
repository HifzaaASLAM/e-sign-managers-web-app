import { NextResponse } from "next/server";
import { isValidInternalJobSecret } from "../../../../../lib/shm/background-jobs";
import { runDueTenantApplicationAutoApprovals } from "../../../../../lib/shm/tenant-application-auto-approve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Safety net for missed delayed jobs (cron or manual trigger). */
export async function POST(request: Request) {
  if (!isValidInternalJobSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const results = await runDueTenantApplicationAutoApprovals(request);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(request: Request) {
  return POST(request);
}
