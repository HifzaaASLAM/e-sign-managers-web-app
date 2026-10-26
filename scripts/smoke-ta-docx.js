/** Quick smoke: fill tenant agreement placeholders and write a readable DOCX. */
const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphsFromMultiline(value, boldLeadLines = true) {
  const blocks = String(value || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length) return "<w:p><w:r><w:t></w:t></w:r></w:p>";
  const paras = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    lines.forEach((line, idx) => {
      const text = escapeXml(line);
      const isHeading = boldLeadLines && idx === 0 && lines.length > 1;
      if (isHeading) {
        paras.push(
          `<w:p><w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
        );
      } else {
        paras.push(
          `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
        );
      }
    });
  }
  return paras.join("");
}

function replacePlaceholderParagraph(xml, needle, value, boldLeadLines = true) {
  if (!xml.includes(needle)) throw new Error("missing " + needle);
  const parasXml = paragraphsFromMultiline(value, boldLeadLines);
  const idx = xml.indexOf(needle);
  const pStart = xml.lastIndexOf("<w:p", idx);
  const pEnd = xml.indexOf("</w:p>", idx);
  return xml.slice(0, pStart) + parasXml + xml.slice(pEnd + "</w:p>".length);
}

const templatePath = path.join("lib", "shm", "templates", "tenant-agreement-template.docx");
const zip = new PizZip(fs.readFileSync(templatePath));
let xml = zip.file("word/document.xml").asText();

const core = [
  "Premises",
  "",
  "Address 125425gsgfgwghfgdf",
  "",
  "Rent",
  "",
  "The rent amount is:",
  "$1360 Per Calendar Month ($120/week)",
  "",
  "3. Bond",
  "",
  "Bond amount $1300",
  "Date bond payment due: 23/07/2026",
].join("\n");

const terms = [
  "11. Water consumption & utilities",
  "Rental Provider will pay charges in respect of water.",
  "",
  "12. Condition report",
  "The Renter acknowledges the Condition Report.",
].join("\n");

const rules = ["1. This is a shared house.", "", "2. Monthly rent will be paid in advance."].join("\n");

xml = xml.split("[[AGREEMENT_DATE]]").join("16/07/2026");
xml = xml.split("[[PROVIDER_NAME]]").join("zigzag");
xml = xml.split("[[TENANT_NAME]]").join("team");
xml = xml.split("[[TENANT_EMAIL]]").join("team@digitechdev.com");
xml = replacePlaceholderParagraph(xml, "[[CORE_SECTIONS]]", core, true);
xml = replacePlaceholderParagraph(xml, "[[ADDITIONAL_TERMS]]", terms, true);
xml = replacePlaceholderParagraph(xml, "[[ADDITIONAL_SHARE_HOUSE_RULES]]", rules, false);

zip.file("word/document.xml", xml);
const out = "C:/Users/Os/Downloads/ta-smoke-test.docx";
fs.writeFileSync(out, zip.generate({ type: "nodebuffer" }));
console.log("wrote", out);

// Print readable extract
const text = xml
  .replace(/<\/w:p>/g, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/\n+/g, "\n");
console.log(text.slice(text.indexOf("Premises") - 20, text.indexOf("Acknowledgement") + 40));
