import fs from "fs";
import PizZip from "pizzip";

function stats(p) {
  if (!fs.existsSync(p)) return { missing: true };
  const z = new PizZip(fs.readFileSync(p));
  const d = z.file("word/document.xml")?.asText() || "";
  return {
    size: fs.statSync(p).size,
    docLen: d.length,
    tr: (d.match(/<w:tr/g) || []).length,
    tbl: (d.match(/<w:tbl/g) || []).length,
    placeholders: (d.match(/\[\[[A-Z_]+\]\]/g) || []).length,
    sectPr: (d.match(/<w:sectPr/g) || []).length,
    bodyClose: d.includes("</w:body>"),
  };
}

const paths = process.argv.slice(2);
for (const p of paths.length ? paths : [
  "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx",
  "E:/esign/shm-app/lib/shm/templates/property-management-agreement-professional-template.docx",
]) {
  console.log(p, stats(p));
}
