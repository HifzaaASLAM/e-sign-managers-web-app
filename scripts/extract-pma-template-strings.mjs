import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "lib/shm/templates/property-management-agreement-professional-template.docx");
const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
  .map((m) => m[1])
  .filter((t) => t.trim().length > 3);
const uniq = [...new Set(texts)].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(path.join(root, "tmp-pma-template-strings.json"), JSON.stringify(uniq, null, 2));
console.log("wrote", uniq.length, "strings");
