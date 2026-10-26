import fs from "fs";
import PizZip from "pizzip";

const p = process.argv[2] || "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();

let depth = 0;
let maxTblDepth = 0;
let tblAtDepth = {};
for (const m of xml.matchAll(/<\/?w:tbl\b|<\/?w:tc\b/g)) {
  const tag = m[0];
  if (tag.startsWith("<w:tbl") && !tag.startsWith("</")) {
    depth++;
    maxTblDepth = Math.max(maxTblDepth, depth);
    tblAtDepth[depth] = (tblAtDepth[depth] || 0) + 1;
  } else if (tag === "</w:tbl>") depth--;
  if (tag.startsWith("<w:tc") && !tag.startsWith("</")) {
    // track tc in tbl depth 1 only count
  }
}
console.log("max nested tbl depth", maxTblDepth, tblAtDepth);

// first 30k chars structure sample
const idx = xml.indexOf("Property Details");
console.log("around Property Details", xml.slice(idx - 200, idx + 800).replace(/\s+/g, " ").slice(0, 500));
