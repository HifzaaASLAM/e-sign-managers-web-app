import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import PizZip from "pizzip";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(path.join(root, "lib/shm/property-management-agreement-docx.ts")).href);

const data = {
  owner: "team",
  property: "2323, Mulbring, New South Wales, Australia",
  available_from: "2026-10-01",
};

const buf = await mod.generatePropertyManagementAgreementDocx(data, {});
const out = path.join(root, "tmp-pma-team-test.docx");
fs.writeFileSync(out, buf);

const xml = new PizZip(buf).file("word/document.xml").asText();
const pOpen = (xml.match(/<w:p\b/g) || []).length;
const pClose = (xml.match(/<\/w:p>/g) || []).length;
console.log({ out, docLen: xml.length, pOpen, pClose, collectRent: xml.includes("Collect rent") });
