import fs from "fs";
import PizZip from "pizzip";

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const xml = new PizZip(fs.readFileSync(ref)).file("word/document.xml").asText();

// extract shaded/bold section cells (w:shd fill)
const sectionCells = [...xml.matchAll(/<w:shd[^>]*w:fill="([^"]+)"[^>]*\/>([\s\S]*?)<\/w:tc>/g)]
  .map((m) => {
    const inner = m[2];
    const t = [...inner.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join("");
    return { fill: m[1], text: t.trim() };
  })
  .filter((x) => x.text);

console.log("Shaded cells:");
sectionCells.forEach((c) => console.log(c.fill, ":", c.text));

const texts = [];
const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
let m;
while ((m = re.exec(xml))) texts.push(m[1]);

console.log("\nAll distinct labels (length 3-80):");
const uniq = [...new Set(texts.map((t) => t.trim()).filter((t) => t.length >= 3 && t.length <= 80))];
uniq.sort().forEach((t) => console.log(t));
