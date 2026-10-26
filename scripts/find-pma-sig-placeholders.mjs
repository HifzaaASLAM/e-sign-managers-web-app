import fs from "fs";
import PizZip from "pizzip";

const p = "E:/esign/shm-app/lib/shm/templates/property-management-agreement-professional-template.docx";
const xml = new PizZip(fs.readFileSync(p)).file("word/document.xml").asText();
const idx = xml.indexOf("Owner (Sign)");
console.log("idx", idx);
console.log(xml.slice(idx - 100, idx + 400));
