import { NextResponse } from "next/server";
import { isValidInternalJobSecret } from "../../../../../lib/shm/background-jobs";
import { processTenantAgreementAutoCreatorSign } from "../../../../../lib/shm/tenant-agreement-auto-creator-sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isValidInternalJobSecret(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const documentId = String(body?.documentId || body?.document_id || body?.doc_id || "").trim();
  const jobId = String(body?.jobId || body?.job_id || "").trim();

  if (!documentId || !jobId) {
    return NextResponse.json({ message: "documentId and jobId are required." }, { status: 400 });
  }

  const result = await processTenantAgreementAutoCreatorSign(documentId, jobId, request);
  return NextResponse.json(result, { status: result.status });
}
