import fs from "fs";
import PizZip from "pizzip";

function load(path) {
  const z = new PizZip(fs.readFileSync(path));
  return {
    path,
    document: z.file("word/document.xml")?.asText() || "",
    files: Object.keys(z.files),
  };
}

function tagBalance(xml) {
  const tags = ["w:tbl", "w:tr", "w:tc", "w:p", "w:body"];
  const out = {};
  for (const t of tags) {
    const open = (xml.match(new RegExp(`<${t}\\b`, "g")) || []).length;
    const close = (xml.match(new RegExp(`</${t}>`, "g")) || []).length;
    out[t] = { open, close, ok: open === close };
  }
  return out;
}

function textAfterPropertyDetails(xml) {
  const i = xml.indexOf("Property Details");
  if (i < 0) return null;
  const slice = xml.slice(i, i + 15000);
  const texts = [...slice.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).filter(Boolean);
  return texts.slice(0, 40);
}

const ref = "C:/Users/Os/Downloads/Property-Management-Agreement-Professional-22-10-2026.docx";
const team = "C:/Users/Os/Downloads/Property-Management-Agreement-team-2026-10-22.docx";

for (const p of [ref, team]) {
  if (!fs.existsSync(p)) {
    console.log("missing", p);
    continue;
  }
  const { document } = load(p);
  console.log("\n===", p);
  console.log("balance", tagBalance(document));
  console.log("texts after Property Details:", textAfterPropertyDetails(document));
}
