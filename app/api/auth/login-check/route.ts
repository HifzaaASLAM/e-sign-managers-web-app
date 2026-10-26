import { NextResponse } from "next/server";
import { verifyUserPassword } from "../../../../lib/local-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) {
      return NextResponse.json({ ok: false, message: "Email and password are required." }, { status: 400 });
    }

    const user = await verifyUserPassword(email, password);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Invalid email or password." }, { status: 401 });
    }

    return NextResponse.json({ ok: true, message: "Credentials valid." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login check failed.";
    console.error("[api/auth/login-check]", message);
    return NextResponse.json({ ok: false, message: "Login check unavailable." }, { status: 500 });
  }
}
