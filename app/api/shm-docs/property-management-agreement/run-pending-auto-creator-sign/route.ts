import { NextResponse } from "next/server";
import { isValidInternalJobSecret } from "../../../../../lib/shm/background-jobs";
import { runDuePmaAutoCreatorSigns } from "../../../../../lib/shm/property-management-agreement-auto-creator-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

async function handleRunPending(request: Request) {
  if (!isValidInternalJobSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const results = await runDuePmaAutoCreatorSigns(request);
  return NextResponse.json({ ok: true, results });
}

export async function POST(request: Request) {
  return handleRunPending(request);
}

/** Optional Hostinger cron: wget -qO- "https://sharehousemanagers.com/api/shm-docs/property-management-agreement/run-pending-auto-creator-sign" */
export async function GET(request: Request) {
  return handleRunPending(request);
}
