const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");

const templatePath = path.join(__dirname, "..", "lib", "shm", "templates", "tenant-agreement-template.docx");
const publicPath = path.join(__dirname, "..", "public", "shm-plugin-assets", "templates", "tenant-agreement-template.docx");
const defaultsJsPath = path.join(__dirname, "..", "lib", "shm", "templates", "ta-default-additional-terms.js");
const publicDefaultsJsPath = path.join(
  __dirname,
  "..",
  "public",
  "shm-plugin-assets",
  "templates",
  "ta-default-additional-terms.js",
);

if (!fs.existsSync(templatePath)) {
  console.error("Missing tenant agreement template:", templatePath);
  process.exit(1);
}

const size = fs.statSync(templatePath).size;
if (size < 50_000) {
  console.error(`Tenant agreement template looks too small (${size} bytes). Expected the prepared Word template.`);
  process.exit(1);
}

if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  fs.copyFileSync(templatePath, publicPath);
  console.log("Copied tenant agreement template to public assets.");
}

if (fs.existsSync(defaultsJsPath)) {
  fs.mkdirSync(path.dirname(publicDefaultsJsPath), { recursive: true });
  fs.copyFileSync(defaultsJsPath, publicDefaultsJsPath);
}

try {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const docXml = zip.file("word/document.xml")?.asText() || "";
  if (!docXml.includes("[[ADDITIONAL_TERMS]]")) {
    console.error("Tenant agreement template is missing [[ADDITIONAL_TERMS]] placeholder.");
    process.exit(1);
  }
  if (!docXml.includes("[[ADDITIONAL_SHARE_HOUSE_RULES]]")) {
    console.error("Tenant agreement template is missing [[ADDITIONAL_SHARE_HOUSE_RULES]] placeholder.");
    process.exit(1);
  }
} catch (error) {
  console.warn("Could not verify tenant agreement placeholders:", error instanceof Error ? error.message : error);
}

console.log(`Tenant agreement template OK (${Math.round(size / 1024)} KB).`);
