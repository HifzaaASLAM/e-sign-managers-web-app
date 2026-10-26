import { NextResponse } from "next/server";
import {
  approveTenantByLandlord,
  getLandlordReviewBundle,
} from "../../../../../lib/shm/tenant-application-landlord-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = String(url.searchParams.get("doc_id") || "").trim();
  const token = String(url.searchParams.get("token") || "").trim();

  if (!documentId || !token) {
    return NextResponse.json({ ok: false, message: "Missing document or token." }, { status: 400 });
  }

  const result = await getLandlordReviewBundle(documentId, token, request);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  }

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const documentId = String(body.doc_id || body.documentId || "").trim();
  const token = String(body.token || "").trim();

  if (!documentId || !token) {
    return NextResponse.json({ ok: false, message: "Missing document or token." }, { status: 400 });
  }

  const result = await approveTenantByLandlord({ documentId, token, request });
  return NextResponse.json(
    {
      ok: result.ok,
      message: result.message,
      alreadyApproved: "alreadyApproved" in result ? result.alreadyApproved : false,
      emailResults: "emailResults" in result ? result.emailResults : undefined,
    },
    { status: result.status },
  );
}
