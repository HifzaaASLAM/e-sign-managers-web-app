import { NextResponse } from "next/server";
import { findInspectionByCaptureToken } from "../../../../../../lib/inspection/auth";
import { MAX_PHOTOS_PER_PART, saveInspectionPhoto } from "../../../../../../lib/inspection/storage";
import { prisma } from "../../../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: { token: string } };

export async function POST(request: Request, context: Ctx) {
  const inspection = await findInspectionByCaptureToken(context.params.token);
  if (!inspection) {
    return NextResponse.json({ ok: false, message: "Invalid or expired link" }, { status: 404 });
  }

  if (inspection.status === "SUBMITTED" || inspection.status === "IN_REVIEW" || inspection.status === "COMPLETED") {
    return NextResponse.json({ ok: false, message: "This inspection is locked." }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "Expected multipart form data" }, { status: 400 });
  }

  const partId = String(form.get("partId") || "");
  const file = form.get("file");
  if (!partId || !(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "partId and file are required" }, { status: 400 });
  }

  const part = inspection.areas.flatMap((a) => a.parts).find((p) => p.id === partId);
  if (!part) {
    return NextResponse.json({ ok: false, message: "Part not found" }, { status: 404 });
  }

  if (part.photos.length >= MAX_PHOTOS_PER_PART) {
    return NextResponse.json({ ok: false, message: `Maximum ${MAX_PHOTOS_PER_PART} photos per part.` }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveInspectionPhoto({
      inspectionId: inspection.id,
      partId,
      buffer,
      mimeType: file.type || "image/jpeg",
      originalName: file.name,
    });

    const photo = await prisma.inspectionPhoto.create({
      data: {
        partId,
        storagePath: saved.storagePath,
        dataBase64: saved.dataBase64,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        size: saved.size,
        sortOrder: part.photos.length,
      },
    });

    return NextResponse.json({
      ok: true,
      photo: {
        id: photo.id,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        sortOrder: photo.sortOrder,
        url: `/api/inspections/photos/${photo.id}?token=${encodeURIComponent(inspection.captureToken)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
