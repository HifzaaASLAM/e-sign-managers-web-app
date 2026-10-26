import { NextResponse } from "next/server";
import { markOwnershipStatementOwnerViewed } from "../../../../../lib/shm/ownership-statement-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const docId = String(searchParams.get("doc_id") || "").trim();
  const token = String(searchParams.get("token") || "").trim();

  if (docId && token) {
    await markOwnershipStatementOwnerViewed(docId, token, request);
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}
