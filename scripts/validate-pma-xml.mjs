import fs from "fs";
import PizZip from "pizzip";

const p = process.argv[2] || "E:/esign/shm-app/tmp-pma-filled.docx";
const d = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();

const markers = [
  "Property Details",
  "Owner",
  "Special Instructions",
  "TERMS",
  "Appointment",
  "Signatures",
  "LETTING",
  "Privacy",
];
for (const m of markers) {
  console.log(m, d.includes(m) ? "yes @ " + d.indexOf(m) : "NO");
}

const bodyOpens = (d.match(/<w:body/g) || []).length;
const bodyCloses = (d.match(/<\/w:body>/g) || []).length;
console.log("body open/close", bodyOpens, bodyCloses);
console.log("document end", d.slice(-120));
