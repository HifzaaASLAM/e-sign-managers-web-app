import fs from "fs";
import PizZip from "pizzip";
import { mergeDocxRuns } from "../lib/shm/docx-utils.ts";

const p = process.argv[2] || "E:/esign/shm-app/lib/shm/templates/property-management-agreement-professional-template.docx";
const raw = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
const merged = mergeDocxRuns(raw);
function stats(d) {
  return {
    len: d.length,
    tr: (d.match(/<w:tr/g) || []).length,
    tbl: (d.match(/<w:tbl/g) || []).length,
    bodyClose: d.includes("</w:body>"),
  };
}
console.log("before", stats(raw));
console.log("after", stats(merged));
