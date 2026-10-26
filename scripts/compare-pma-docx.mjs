import fs from "fs";
import PizZip from "pizzip";

function load(p) {
  const z = new PizZip(fs.readFileSync(p));
  return {
    path: p,
    size: fs.statSync(p).size,
    document: z.file("word/document.xml")?.asText() || "",
    styles: z.file("word/styles.xml")?.asText() || "",
    header: z.file("word/header1.xml")?.asText() || "",
    files: Object.keys(z.files),
  };
}

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const tpl = "E:/esign/shm-app/lib/shm/templates/property-management-agreement-template.docx";

for (const p of [ref, tpl]) {
  if (!fs.existsSync(p)) {
    console.log("MISSING", p);
    continue;
  }
  const d = load(p);
  const texts = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(d.document))) texts.push(m[1]);
  console.log("\n===", p);
  console.log("size", d.size, "textNodes", texts.length, "hasHeader", d.files.some((f) => f.startsWith("word/header")));
  const headers = texts.filter((t) =>
    /^(Property Details|PROPERTY DETAILS|Owner Details|OWNER DETAILS|Terms|TERMS|Specific|SPECIAL|Signatures|Property Management Agreement)/i.test(t.trim()),
  );
  console.log("headers:", [...new Set(headers)].join(" | "));
  console.log("tail:", texts.slice(-30).join(" | "));
}
