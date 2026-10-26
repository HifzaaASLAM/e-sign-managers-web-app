import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { validateShmToken } from "../../../../../lib/shm/documents";
import { getOwnershipStatementSendJob } from "../../../../../lib/shm/ownership-statement-send-processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const docId = String(searchParams.get("doc_id") || "").trim();
  const token = String(searchParams.get("token") || "").trim();
  const jobId = String(searchParams.get("job_id") || "").trim();

  if (!docId) {
    return NextResponse.json({ message: "doc_id is required." }, { status: 400 });
  }

  let doc = null;
  if (token) {
    doc = await validateShmToken(docId, token);
    if (!doc || doc.adminToken !== token) {
      return NextResponse.json({ message: "Invalid admin signing link" }, { status: 403 });
    }
  } else if (jobId) {
    doc = await prisma.shmDocument.findUnique({ where: { documentId: docId } });
    const job = getOwnershipStatementSendJob(doc?.agreementData || null);
    if (!doc || !job || job.id !== jobId) {
      return NextResponse.json({ message: "Invalid send job." }, { status: 403 });
    }
  } else {
    return NextResponse.json({ message: "token or job_id is required." }, { status: 400 });
  }

  const job = getOwnershipStatementSendJob(doc.agreementData);
  if (!job) {
    return NextResponse.json({ job: null, message: "No send job found." });
  }

  return NextResponse.json({
    job,
    document_status: doc.status,
  });
}
