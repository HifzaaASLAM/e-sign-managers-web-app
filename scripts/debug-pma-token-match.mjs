import fs from "fs";
import PizZip from "pizzip";

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const xml = new PizZip(fs.readFileSync(ref)).file("word/document.xml").asText();
function findTcTag(documentXml, from, kind) {
  let p = from;
  while (p < documentXml.length) {
    if (kind === "open") {
      const idx = documentXml.indexOf("<w:tc", p);
      if (idx === -1) return -1;
      const next = documentXml[idx + 5];
      if (next === ">" || next === " " || next === "/") return idx;
      p = idx + 5;
      continue;
    }
    return documentXml.indexOf("</w:tc>", p);
  }
  return -1;
}
function extractCells(documentXml) {
  const cells = [];
  let i = 0;
  while (i < documentXml.length) {
    const start = findTcTag(documentXml, i, "open");
    if (start === -1) break;
    const openEnd = documentXml.indexOf(">", start);
    if (openEnd === -1) break;
    let pos = openEnd + 1;
    let depth = 1;
    while (pos < documentXml.length && depth > 0) {
      const open = findTcTag(documentXml, pos, "open");
      const close = findTcTag(documentXml, pos, "close");
      if (close === -1) break;
      if (open !== -1 && open < close) {
        depth += 1;
        pos = open + 5;
      } else {
        depth -= 1;
        pos = close + 7;
      }
    }
    cells.push(documentXml.slice(start, pos));
    i = pos;
  }
  return cells;
}
const cells = extractCells(xml);
console.log("cells", cells.length);

function cellText(cell) {
  return [...cell.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("");
}
function norm(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

console.log("cell2 starts", cells[2].slice(0, 40));
console.log("cell2 label", JSON.stringify(cellText(cells[2])));
console.log("total cells", cells.length);
