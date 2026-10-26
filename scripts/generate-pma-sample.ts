import fs from "fs";
import PizZip from "pizzip";
import { generatePropertyManagementAgreementBuiltDocx } from "../lib/shm/property-management-agreement-built-docx";

const sample = {
  available_from: "08/07/2026",
  available_to: "06/08/2026",
  property: "123 Example Street, Melbourne VIC 3000",
  block: "12",
  section: "A",
  division: "North",
  eer: "5.5",
  owner: "Jordan Smith",
  postal_address: "PO Box 100, Melbourne VIC 3000",
  phone_ah: "0399999999",
  phone_bh: "0388888888",
  mobile: "0412345678",
  email: "team@digitechdev.com",
  unit_plan_no: "UP-445",
  unit_plan_manager: "Body Corp Co",
  unit_phone: "0377777777",
  fax: "0399999998",
  description: "3 bedroom house with garage and rear yard",
  property_type: "House",
  heating: "Gas ducted",
  hot_water: "Gas",
  dishwasher: "Yes",
  oven: "Electric",
  cooktop: "Gas",
  warranties: "2 years remaining",
  rent_pw: "$650",
  commencement: "01/08/2026",
  lease_term: "12 months",
  keys: "3 sets",
  deposit_to: "Jordan Smith",
  bank: "Commonwealth Bank",
  branch: "Melbourne CBD",
  bsb: "063-000",
  account: "12345678",
  repairs: "Refer to landlord for advice",
  asbestos: "Yes",
  asbestos_note: "Kitchen ceiling",
  glass: "Yes",
  glass_note: "Front windows",
  smoke: "Yes",
  structures: "No",
  rates_general: "Yes",
  rates_water: "Yes",
  land_tax: "No",
  preferred_contact: "Email",
  body_corp: "No",
  fair_clause: "Yes",
  email_statements: "Yes",
  building_insurer: "Allianz",
  building_policy: "BP-10001",
  building_renewal: "15/01/2027",
  contents_insurer: "NRMA",
  contents_policy: "CP-20002",
  contents_renewal: "20/02/2027",
  landlord_insurer: "Suncorp",
  landlord_policy: "LP-30003",
  landlord_renewal: "10/03/2027",
  other_instructions: "Tenant must maintain garden",
  pets: "Yes",
  groups: "No",
  emergency_contact: "Jane Smith",
  emergency_phone: "0411222333",
  intend_sell: "No",
  special_instructions: "Pool maintenance monthly",
  instruction_books: "Kitchen drawer",
  hot_water_location: "Laundry",
  meter_box: "Front porch",
  water_meter: "Front nature strip",
  additional_info: "Spa requires quarterly service",
  owner_sign_name: "Jordan Smith",
  sig_date: "03/07/2026",
  agent_sign_name: "ShareHouse Managers",
  agent_sig_date: "03/07/2026",
  submittedAt: "03/07/2026, 2:30:00 pm",
};

const sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAFCAYAAABWPjiCAAAAHElEQVQYV2NkYGD4z0AEYBxVSF+FABJADQAJbAqXAAAAAElFTkSuQmCC";

async function main() {
  const buf = await generatePropertyManagementAgreementBuiltDocx(sample, {
    ownerSignature: sig,
    agentSignature: sig,
  });
  const outDocx = "c:/Users/Os/Downloads/PMA-SAMPLE-OUTPUT.docx";
  const outTxt = "c:/Users/Os/Downloads/PMA-SAMPLE-OUTPUT.txt";
  fs.writeFileSync(outDocx, buf);
  const zip = new PizZip(buf);
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw new Error("word/document.xml missing from generated DOCX");
  }
  const xml = documentXml.asText();
  const text = xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  fs.writeFileSync(outTxt, text);
  console.log(outDocx);
  console.log(outTxt);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
