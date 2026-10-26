import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(path.join(root, "lib/shm/property-management-agreement-docx.ts")).href);

const data = {
  owner: "Test Owner",
  available_from: "2026-01-01",
  property: "123 Test St",
  asbestos: "Yes",
};

const buf = await mod.generatePropertyManagementAgreementDocx(data, {});
const out = path.join(root, "tmp-pma-filled.docx");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);

const { default: PizZip } = await import("pizzip");
const z = new PizZip(buf);
const d = z.file("word/document.xml")?.asText() || "";
console.log("filled", {
  out,
  docLen: d.length,
  tr: (d.match(/<w:tr/g) || []).length,
  bodyClose: d.includes("</w:body>"),
  hasTerms: /TERMS|Terms and Conditions|APPOINTMENT/i.test(d),
  leftoverPh: (d.match(/\[\[[A-Z_]+\]\]/g) || []).length,
});
