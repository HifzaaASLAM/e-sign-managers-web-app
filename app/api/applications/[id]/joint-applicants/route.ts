import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { addJointApplicant } from "../../../../../lib/applications/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function POST(request: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) {
    return NextResponse.json({ ok: false, message: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || body.recipientName || "").trim();
  const email = String(body.email || body.recipientEmail || "").trim().toLowerCase();
  if (!name || !email) {
    return NextResponse.json({ ok: false, message: "Name and email are required." }, { status: 400 });
  }

  try {
    const result = await addJointApplicant({
      applicationId: params.id,
      companyId: company.id,
      user: { id: user.id, name: user.name, email: user.email },
      name,
      email,
      request,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Could not add joint applicant" },
      { status: 400 },
    );
  }
}
