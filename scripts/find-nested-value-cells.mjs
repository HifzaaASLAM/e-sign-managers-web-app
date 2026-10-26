import fs from "fs";
import PizZip from "pizzip";

// same helpers as build script
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

function extractDirectRowCells(rowXml) {
  const rowOpenEnd = rowXml.indexOf(">");
  if (rowOpenEnd === -1) return [];
  const rowClose = rowXml.lastIndexOf("</w:tr>");
  if (rowClose === -1) return [];
  const cells = [];
  let pos = rowOpenEnd + 1;
  while (pos < rowClose) {
    const start = findTcTag(rowXml, pos, "open");
    if (start === -1 || start >= rowClose) break;
    const openEnd = rowXml.indexOf(">", start);
    let depth = 1;
    let p = openEnd + 1;
    while (p < rowClose && depth > 0) {
      const open = findTcTag(rowXml, p, "open");
      const close = findTcTag(rowXml, p, "close");
      if (close === -1 || close > rowClose) break;
      if (open !== -1 && open < close) {
        depth += 1;
        p = open + 5;
      } else {
        depth -= 1;
        p = close + 7;
      }
    }
    cells.push(rowXml.slice(start, p));
    pos = p;
  }
  return cells;
}

function cellText(cellXml) {
  const paras = cellXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  for (let i = paras.length - 1; i >= 0; i--) {
    const text = [...paras[i].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

const tpl = new PizZip(fs.readFileSync("E:/esign/shm-app/lib/shm/templates/property-management-agreement-professional-template.docx")).file("word/document.xml").asText();
let hits = 0;
for (const row of tpl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
  const cells = extractDirectRowCells(row[0]);
  for (let i = 0; i + 1 < cells.length; i += 2) {
    const label = cellText(cells[i]).trim();
    if (cells[i + 1].includes("<w:tbl") && label) {
      hits++;
      if (hits <= 8) console.log("nested value cell for label:", label.slice(0, 60));
    }
    if (cells[i + 1].includes("[[") && cells[i + 1].includes("<w:tbl")) {
      console.log("BAD placeholder inside nested tbl:", label);
    }
  }
}
console.log("nested value cells total", hits);
