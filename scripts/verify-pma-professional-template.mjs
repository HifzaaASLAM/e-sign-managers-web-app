import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tpl = path.join(root, "lib/shm/templates/property-management-agreement-professional-template.docx");

if (!fs.existsSync(tpl)) {
  console.error("PMA professional template missing:", tpl);
  console.error("Run: node scripts/build-pma-professional-template.mjs");
  process.exit(1);
}

const size = fs.statSync(tpl).size;
const doc = new PizZip(fs.readFileSync(tpl)).file("word/document.xml")?.asText() || "";
const docLen = doc.length;
const tbl = (doc.match(/<w:tbl\b/g) || []).length;

if (size < 3_000_000 || docLen < 180_000 || tbl < 7) {
  console.error("PMA professional template looks truncated or stale.", { size, docLen, tbl });
  process.exit(1);
}

console.log(`PMA professional template OK (${Math.round(size / 1024)} KB, document.xml ${Math.round(docLen / 1024)} KB).`);
