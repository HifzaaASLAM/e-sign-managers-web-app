import fs from "fs";
import PizZip from "pizzip";

const p = process.argv[2];
const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
const bodyMatch = xml.match(/<w:body>([\s\S]*?)<w:sectPr/);
if (!bodyMatch) {
  console.log("no body");
  process.exit(1);
}
const body = bodyMatch[1];
const directTbl = (body.match(/<w:tbl\b/g) || []).length;
const directP = (body.match(/<w:p\b/g) || []).length;
console.log("body len", body.length, "direct tbl open tags in body", directTbl, "direct p", directP);

// depth of first 5000 chars
let i = body.indexOf("<w:tbl");
console.log("first tbl at", i);

// section headers in plain text
const headers = [
  "Property Details",
  "Owner",
  "Specific Instructions",
  "Insurance",
  "TERMS",
  "Schedule of Fees",
  "Signatures",
];
for (const h of headers) {
  const idx = xml.indexOf(h);
  console.log(h, idx >= 0 ? idx : "missing");
}

const snippets = ["Collect rent", "Management fee", "Privacy Act", "team", "2323"];
for (const s of snippets) {
  console.log(s, xml.includes(s) ? "yes" : "NO");
}
