import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../../lib/workspace";
import { prisma } from "../../../../../lib/prisma";
import { readInspectionPhoto } from "../../../../../lib/inspection/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { photoId: string } };

export async function GET(request: Request, context: Ctx) {
  const photo = await prisma.inspectionPhoto.findUnique({
    where: { id: context.params.photoId },
    include: {
      part: {
        include: {
          area: {
            include: {
              inspection: true,
            },
          },
        },
      },
    },
  });

  if (!photo) {
    return NextResponse.json({ ok: false, message: "Not found" }, { status: 404 });
  }

  const inspection = photo.part.area.inspection;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "";
  const admin = searchParams.get("admin") === "1";

  let allowed = false;

  if (token && (token === inspection.captureToken || token === inspection.reportToken)) {
    allowed = true;
  }

  if (!allowed && admin) {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      try {
        const { company } = await getWorkspaceByEmail(session.user.email);
        if (company?.id && company.id === inspection.companyId) {
          allowed = true;
        }
      } catch {
        allowed = false;
      }
    }
  }

  if (!allowed) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const buffer = await readInspectionPhoto(photo.storagePath, photo.dataBase64);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": photo.mimeType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${photo.fileName.replace(/"/g, "")}"`,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, message: "File missing" }, { status: 404 });
  }
}
