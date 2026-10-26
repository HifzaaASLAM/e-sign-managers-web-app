import fs from "fs";
import PizZip from "pizzip";

const ref = process.argv[2] || "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const z = new PizZip(fs.readFileSync(ref));
const xml = z.file("word/document.xml").asText();
const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
const texts = [];
let m;
while ((m = re.exec(xml))) texts.push(m[1]);

console.log("text nodes:", texts.length);
const joined = texts.join("");
console.log("joined length:", joined.length);

const caps = texts.filter((t) => /^[A-Z][A-Z0-9 ()/.,\-]{6,}$/.test(t.trim()));
console.log("\nSection-like (CAPS):");
for (const c of caps) console.log(" -", c.trim());

console.log("\nFirst 100 text nodes:");
texts.slice(0, 100).forEach((t, i) => console.log(String(i + 1).padStart(3), t));
