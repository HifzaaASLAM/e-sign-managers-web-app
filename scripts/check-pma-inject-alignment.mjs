import fs from "fs";
import PizZip from "pizzip";

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

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const tpl = "E:/esign/shm-app/lib/shm/templates/property-management-agreement-professional-template.docx";

for (const [name, p] of [
  ["ref", ref],
  ["tpl", tpl],
]) {
  const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
  const cells = extractCells(xml);
  const dup = new Map();
  let alignFails = 0;
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    dup.set(c, (dup.get(c) || 0) + 1);
    const idx = xml.indexOf(c, ci === 0 ? 0 : undefined);
    // simulate inject cursor alignment
  }
  let cursor = 0;
  for (let ci = 0; ci < cells.length; ci++) {
    const idx = xml.indexOf(cells[ci], cursor);
    if (idx === -1) alignFails++;
    else cursor = idx + cells[ci].length;
  }
  const dupCount = [...dup.values()].filter((n) => n > 1).length;
  console.log(name, { cells: cells.length, dupCount, alignFails });
}
