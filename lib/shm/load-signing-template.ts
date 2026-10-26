import fs from "fs/promises";
import path from "path";
import { templateFileForDocumentType } from "./documents";

const templateBuildId = process.env.NEXT_PUBLIC_SHM_BUILD_ID || "dev";
const templateCache = new Map<string, { buildId: string; html: string }>();

/** Load a signing HTML template with an in-memory cache (avoids disk I/O on every open). */
export async function loadSigningTemplateHtml(documentType: string) {
  const fileName = templateFileForDocumentType(documentType);
  const cached = templateCache.get(fileName);
  if (cached && cached.buildId === templateBuildId) return cached.html;

  const templatePath = path.join(process.cwd(), "lib", "shm", "templates", fileName);
  const html = await fs.readFile(templatePath, "utf8");
  templateCache.set(fileName, { buildId: templateBuildId, html });
  return html;
}
