import { readFile } from "fs/promises";
import path from "path";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Fallback if no PNG is present on the server (prefer public/shm-plugin-assets/images/creator-auto-signature.png). */
const FALLBACK_SIGNATURE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAAA8CAYAAAAjW/WRAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAByklEQVR42u3aMQ0AAAgDMO5/0x0h3K2C4JmZGR8BAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgMD/ARgBAAE1c0k6AAAAAElFTkSuQmCC";

function defaultCreatorSignatureCandidates() {
  const imagesDir = path.join(process.cwd(), "public", "shm-plugin-assets", "images");
  return [
    path.join(imagesDir, "creator-auto-signature-original.png"),
    path.join(imagesDir, "creator-auto-signature.png"),
    path.join(imagesDir, "creator-auto-signature-word-embed.png"),
    path.join(imagesDir, "pma-default-agent-signature-original.png"),
    path.join(imagesDir, "pma-default-agent-signature-word-embed.png"),
    path.join(imagesDir, "pma-default-agent-signature.png"),
  ];
}

async function readSignatureFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "image/png";
  const buffer = await readFile(filePath);
  if (!buffer.length) return null;
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export async function loadCreatorAutoSignatureDataUrl(): Promise<string> {
  const configured = process.env.CREATOR_AUTO_SIGNATURE_PATH?.trim();
  const candidates = configured
    ? [configured, ...defaultCreatorSignatureCandidates()]
    : defaultCreatorSignatureCandidates();

  for (const filePath of candidates) {
    try {
      const dataUrl = await readSignatureFile(filePath);
      if (dataUrl) return dataUrl;
    } catch {
      // try next candidate
    }
  }

  return `data:image/png;base64,${FALLBACK_SIGNATURE_PNG}`;
}
