import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "lib/shm/templates/property-management-agreement-professional-template.docx");
const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();

for (const needle of [
  "The Owner appoints Sharehousemanagers",
  "Equal to 0 weeks rent",
  "Appointment of Agent",
]) {
  const idx = xml.indexOf(needle);
  const snippet = xml.slice(Math.max(0, idx - 80), idx + 120);
  const inTc = snippet.includes("<w:tc") || (idx > 0 && xml.slice(idx - 500, idx).includes("<w:tc"));
  console.log(needle, "inTc?", inTc, "idx", idx);
}
