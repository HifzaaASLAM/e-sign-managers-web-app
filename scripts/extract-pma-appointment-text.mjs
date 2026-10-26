import fs from "fs";
import PizZip from "pizzip";

const paths = process.argv.slice(2);
for (const p of paths) {
  const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
  const m = xml.match(/APPOINTMENT OF AGENT[\s\S]{0,12000}?The Owner appoints[^<]{0,200}/);
  console.log("\n", p, m ? m[0].slice(-250) : "NOT FOUND");
  const allText = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join("");
  console.log("has Duties of Agent bullets:", allText.includes("Execute all documentation"));
  console.log("has fee schedule:", allText.includes("Initial letting fee") || allText.includes("letting fee"));
}
