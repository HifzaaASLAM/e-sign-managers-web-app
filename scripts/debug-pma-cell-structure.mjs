import fs from "fs";
import PizZip from "pizzip";

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const xml = new PizZip(fs.readFileSync(ref)).file("word/document.xml").asText();
const cells = xml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
let i = 0;
for (const cell of cells.slice(0, 25)) {
  const paras = cell.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const texts = paras.map((p) =>
    [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""),
  );
  console.log(i++, "paras", paras.length, JSON.stringify(texts));
}
