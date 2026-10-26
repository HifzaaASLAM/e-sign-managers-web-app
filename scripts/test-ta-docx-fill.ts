import fs from "fs";
import path from "path";
import { generateTenantAgreementDocx } from "../lib/shm/tenant-agreement-docx";
import PizZip from "pizzip";

async function main() {
  const data = {
    agreement_date: "2026-07-16",
    provider_name: "zigzag",
    tenant_name: "team",
    tenant_email: "team@digitechdev.com",
    premises_address: "125425 Test Street Hawthorn",
    monthly_rent: "1360",
    weekly_rent: "120",
    bond_amount: "1300",
    bond_payment_due: "2026-07-23",
    commencement_date: "2026-07-16",
    terminate_date: "2026-09-16",
    core_sections: [
      { title: "Premises", body: "Address [[PREMISES_ADDRESS]]", selected: true },
      { title: "3. Bond", body: "Bond amount $[[BOND_AMOUNT]]\nDate bond payment due: [[BOND_PAYMENT_DUE]]", selected: true },
      { title: "Residential Tenancies Act 1997", body: "Each party must comply with the Act", selected: true },
    ],
    additional_terms: [
      { text: "11. Water consumption & utilities\nRental Provider will pay charges.", selected: true },
      { text: "12. Condition report\nThe Renter acknowledges the report.", selected: true },
    ],
    share_house_rules: [
      { text: "This is a shared house.", selected: true },
      { text: "Monthly rent will be paid in advance.", selected: true },
    ],
  };

  const buf = await generateTenantAgreementDocx(data, { documentId: "SHM-TEST" });
  const outPath = path.join("C:/Users/Os/Downloads", "ta-fill-test.docx");
  fs.writeFileSync(outPath, buf);

  const zip = new PizZip(buf);
  const xml = zip.file("word/document.xml")!.asText();
  const waterIdx = xml.indexOf("Water consumption");
  const premisesIdx = xml.indexOf(">Premises<") >= 0 ? xml.indexOf(">Premises<") : xml.indexOf("Premises");
  const chunk = xml.slice(Math.max(0, premisesIdx), premisesIdx + 800).replace(/<[^>]+>/g, "|");

  console.log(
    JSON.stringify(
      {
        outPath,
        hasRTA: xml.includes("Residential Tenancies Act 1997"),
        hasRule1: xml.includes("This is a shared house"),
        hasTerm11: xml.includes("Water consumption"),
        hasFilledAddress: xml.includes("125425 Test Street Hawthorn"),
        hasFilledBond: xml.includes("Bond amount $1300"),
        softBrNearWater: waterIdx >= 0 && xml.slice(waterIdx, waterIdx + 250).includes("<w:br/>"),
        leftPlaceholders: xml.match(/\[\[[A-Z_]+\]\]/g) || [],
        separateParas: (xml.match(/<\/w:p><w:p>/g) || []).length > 20,
      },
      null,
      2,
    ),
  );
  console.log("CHUNK", chunk.slice(0, 500));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
