import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import PizZip from "pizzip";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(
  pathToFileURL(path.join(root, "lib/shm/property-management-agreement-docx.ts")).href
);

const data = {
  owner: "Test Owner",
  property: "1 Test St",
  term_appointment: "CUSTOM APPOINTMENT TEXT",
  term_management_fees: "CUSTOM FEES REF",
  term_termination: "CUSTOM TERMINATION",
  term_keys: "CUSTOM KEYS",
  term_insurance: "CUSTOM INSURANCE",
  term_duties: "DUTY ONE\nDUTY TWO\nDUTY THREE\nDUTY FOUR\nDUTY FIVE\nDUTY SIX",
  term_expenditure: "CUSTOM EXPENDITURE ALL IN ONE",
  term_privacy: "CUSTOM PRIVACY",
  fee_initial_letting: "2 weeks rent",
  fee_advertising: "Custom ads",
  fee_quick_rent_sign: "Custom sign",
  fee_attendance: "Custom attendance block",
  fee_renegotiation: "5% reneg",
  fee_management: "12%",
  fee_monthly_statement: "$25",
  fee_tribunal: "Custom tribunal fees",
  fee_gst: "GST custom note",
};

const buf = await mod.generatePropertyManagementAgreementDocx(data, {});
const xml = new PizZip(buf).file("word/document.xml").asText();
const checks = [
  "CUSTOM APPOINTMENT",
  "CUSTOM FEES REF",
  "CUSTOM TERMINATION",
  "DUTY ONE",
  "CUSTOM EXPENDITURE",
  "2 weeks rent",
  "Management fee 12%",
  "GST custom",
  "Teams",
  "DigiTechDev",
  "reach.hifza",
];
for (const c of checks) {
  console.log(c, xml.includes(c) ? "OK" : "MISSING");
}
