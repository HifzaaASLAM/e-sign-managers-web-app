import { buildTenantAgreementTemplateData } from "../lib/shm/tenant-agreement-export";
import { generateTenantAgreementDocx } from "../lib/shm/tenant-agreement-docx";
import PizZip from "pizzip";

async function main() {
  const data = {
    additional_terms: [
      { title: "11. Water", body: "A", selected: true },
      { title: "12. Condition", body: "B", selected: true },
      { title: "13. Skip", body: "X", selected: false },
      { title: "14. Pets", body: "C", selected: true },
    ],
    share_house_rules: [
      { text: "1. Keep me", selected: true },
      { text: "2. Skip", selected: false },
      { text: "3. Also keep", selected: true },
    ],
  };
  const d = buildTenantAgreementTemplateData(data);
  console.log("TERMS:\n" + d.additional_terms);
  console.log("RULES:\n" + d.additional_share_house_rules);

  const buf = await generateTenantAgreementDocx(
    {
      ...data,
      agreement_date: "2026-07-17",
      tenant_name: "t",
      tenant_email: "t@x.com",
      provider_name: "p",
      premises_address: "a",
      monthly_rent: "1",
      weekly_rent: "1",
      bond_amount: "1",
      bond_payment_due: "2026-07-23",
      commencement_date: "2026-07-16",
      terminate_date: "2026-09-16",
    },
    { documentId: "SHM-FONT" },
  );
  const xml = new PizZip(buf).file("word/document.xml")!.asText();
  console.log("has heading color", xml.includes('w:color w:val="0F172A"'));
  console.log("has body color", xml.includes('w:color w:val="1E1E1E"'));
  console.log("has Arial in injected", xml.includes('w:ascii="Arial"'));
  console.log("has 14. Pets? (should be renumbered to 13)", xml.includes("14. Pets"), "has 13. Pets", xml.includes("13. Pets"));
  console.log("has Skip?", xml.includes("Skip"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
