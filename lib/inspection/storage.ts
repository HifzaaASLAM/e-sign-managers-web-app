import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_PART = 10;

export function inspectionUploadsRoot() {
  return path.join(process.cwd(), "uploads", "inspections");
}

export function absolutePhotoPath(storagePath: string) {
  const root = inspectionUploadsRoot();
  const resolved = path.resolve(root, storagePath);
  if (!resolved.startsWith(root)) {
    throw new Error("Invalid storage path");
  }
  return resolved;
}

export function assertAllowedImage(mimeType: string, size: number) {
  const mime = (mimeType || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error("Only JPEG, PNG, or WebP images are allowed.");
  }
  if (size > MAX_BYTES) {
    throw new Error("Each photo must be 8MB or smaller.");
  }
}

function extensionForMime(mimeType: string) {
  const mime = mimeType.toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

export async function saveInspectionPhoto(input: {
  inspectionId: string;
  partId: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}) {
  assertAllowedImage(input.mimeType, input.buffer.length);
  const ext = extensionForMime(input.mimeType);
  const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  const relativeDir = path.join(input.inspectionId, input.partId);
  const absoluteDir = path.join(inspectionUploadsRoot(), relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absoluteFile = path.join(absoluteDir, fileName);
  try {
    await writeFile(absoluteFile, input.buffer);
  } catch {
    // Disk may be read-only on some hosts; DB copy is the durable source.
  }
  return {
    storagePath: path.join(relativeDir, fileName).replace(/\\/g, "/"),
    dataBase64: input.buffer.toString("base64"),
    fileName: input.originalName?.trim() || fileName,
    mimeType: input.mimeType.toLowerCase(),
    size: input.buffer.length,
  };
}

export async function readInspectionPhoto(storagePath: string, dataBase64?: string | null) {
  if (dataBase64) {
    return Buffer.from(dataBase64, "base64");
  }
  return readFile(absolutePhotoPath(storagePath));
}

export async function deleteInspectionPhotoFile(storagePath: string) {
  try {
    await unlink(absolutePhotoPath(storagePath));
  } catch {
    // ignore missing files
  }
}
