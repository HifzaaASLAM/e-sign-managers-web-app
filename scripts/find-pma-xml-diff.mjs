import fs from "fs";
import PizZip from "pizzip";

function doc(path) {
  return new PizZip(fs.readFileSync(path)).file("word/document.xml").asText();
}

const ref = doc("C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx");
const team = doc("C:/Users/Os/Downloads/Property-Management-Agreement-team-2026-10-22.docx");

let firstDiff = -1;
const len = Math.min(ref.length, team.length);
for (let i = 0; i < len; i++) {
  if (ref[i] !== team[i]) {
    firstDiff = i;
    break;
  }
}
console.log("lengths", ref.length, team.length, "firstDiff", firstDiff);
if (firstDiff >= 0) {
  console.log("ref@", ref.slice(firstDiff, firstDiff + 200).replace(/\s+/g, " "));
  console.log("team@", team.slice(firstDiff, firstDiff + 200).replace(/\s+/g, " "));
}

// Count w:t with substantial text in terms region
const termsIdx = team.indexOf("APPOINTMENT OF AGENT");
if (termsIdx > 0) {
  const chunk = team.slice(termsIdx, termsIdx + 8000);
  const texts = [...chunk.matchAll(/<w:t[^>]*>([^<]{20,})<\/w:t>/g)].map((m) => m[1].slice(0, 80));
  console.log("long terms texts sample:", texts.slice(0, 5));
}
