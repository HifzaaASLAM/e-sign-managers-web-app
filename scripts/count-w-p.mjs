import fs from "fs";
import PizZip from "pizzip";
for (const p of process.argv.slice(2)) {
  const x = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
  console.log(p, "len", x.length, "pOpen", (x.match(/<w:p\b/g) || []).length, "pClose", (x.match(/<\/w:p>/g) || []).length);
}
