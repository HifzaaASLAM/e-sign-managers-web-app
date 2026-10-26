import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { generateTenantAgreementDocx } from "../lib/shm/tenant-agreement-docx";

async function main() {
  const data = {
    agreement_date: "2026-07-17",
    provider_name: "hifza",
    tenant_name: "beams testing",
    tenant_email: "team@digitechdev.com",
    premises_address: "24 Muir St, Hawthorn VIC 3122",
    monthly_rent: "1360",
    weekly_rent: "120",
    bond_amount: "1300",
    bond_payment_due: "2026-07-23",
    commencement_date: "2026-07-16",
    terminate_date: "2026-09-16",
    additional_terms: [
      {
        title: "11. Water consumption & utilities",
        body: "Rental Provider will pay charges in respect of the re-connection and consumption of water, gas, electricity and the Internet.",
        selected: true,
      },
      {
        title: "12. Condition report",
        body: "The Renter acknowledges that the Condition Report provided by Email at the commencement of the tenancy must be acknowledged or signed and returned.",
        selected: true,
      },
      { title: "13. Insurance", body: "Should be skipped", selected: false },
    ],
    share_house_rules: [
      { text: "This is a shared house (not a rooming house).", selected: true },
      { text: "Monthly rent will be paid in advance from the move-in day.", selected: true },
      { text: "Skip me", selected: false },
    ],
  };

  const buf = await generateTenantAgreementDocx(data, { documentId: "SHM-TEST-FULL" });
  const outPath = path.join("C:/Users/Os/Downloads", "ta-full-layout-test.docx");
  fs.writeFileSync(outPath, buf);

  const zip = new PizZip(buf);
  const xml = zip.file("word/document.xml")!.asText();
  const text = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\n+/g, "\n");

  const checks = {
    outPath,
    hasPremises: text.includes("Premises"),
    hasAddressFilled: text.includes("24 Muir St, Hawthorn VIC 3122"),
    hasRentFilled: text.includes("1360") && text.includes("120"),
    hasBondFilled: text.includes("1300"),
    hasBondDue: text.includes("23/07/2026") || text.includes("23/07/2026"),
    hasWaterTerm: text.includes("Water consumption"),
    hasConditionTerm: text.includes("Condition report"),
    skippedInsurance: !text.includes("Should be skipped"),
    hasShareRule: text.includes("shared house"),
    skippedRule: !text.includes("Skip me"),
    hasAck: text.includes("Acknowledgement"),
    leftPlaceholders: text.match(/\[\[[A-Z0-9_]+\]\]/g) || [],
  };
  console.log(JSON.stringify(checks, null, 2));

  const i = text.indexOf("Premises");
  console.log("---PREMISES ZONE---");
  console.log(text.slice(i, i + 900));
  const j = text.indexOf("Additional terms");
  console.log("---ADDITIONAL TERMS ZONE---");
  console.log(text.slice(j, j + 700));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
