import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { generateTenantAgreementDocx } from "../lib/shm/tenant-agreement-docx";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";

async function main() {
  const data = {
    agreement_date: "2026-07-17",
    provider_name: "hifza",
    provider_email: "info@sharehousemanagers.com.au",
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
      { title: "11. Water", body: "Keep water term", selected: true },
      { title: "12. Skip", body: "SHOULD_NOT_APPEAR_TERM", selected: false },
    ],
    additional_terms_text:
      "11. Water\nKeep water term\n\n12. Skip\nSHOULD_NOT_APPEAR_TERM\n\n13. Also stale",
    share_house_rules: [
      { text: "Shared house rule keep", selected: true },
      { text: "SHOULD_NOT_APPEAR_RULE", selected: false },
    ],
    additional_share_house_rules: "1. Shared house rule keep\n\n2. SHOULD_NOT_APPEAR_RULE",
  };

  const buf = await generateTenantAgreementDocx(data, {
    documentId: "SHM-TEST-SIG",
    signedAt: new Date("2026-07-16T10:00:00"),
    tenantSignature: tinyPng,
    providerSignature: tinyPng,
  });
  const outPath = path.join("C:/Users/Os/Downloads", `ta-sig-audit-test-${Date.now()}.docx`);
  fs.writeFileSync(outPath, buf);

  const zip = new PizZip(buf);
  const xml = zip.file("word/document.xml")!.asText();
  const text = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\n+/g, "\n");

  const img2 = zip.file("word/media/image2.png")!.asUint8Array();
  const img3 = zip.file("word/media/image3.png")!.asUint8Array();

  console.log(
    JSON.stringify(
      {
        outPath,
        hasPremises: text.includes("Premises"),
        skippedTerm: !text.includes("SHOULD_NOT_APPEAR_TERM"),
        skippedStale: !text.includes("Also stale"),
        hasWater: text.includes("Keep water term"),
        skippedRule: !text.includes("SHOULD_NOT_APPEAR_RULE"),
        hasRule: text.includes("Shared house rule keep"),
        hasAudit: text.includes("Document finalized") && text.includes("Contract is sent"),
        hasDocId: text.includes("SHM-TEST-SIG"),
        hasProviderEmail: text.includes("info@sharehousemanagers.com.au"),
        hasElectronic: text.includes("Electronic Signatures"),
        leftPlaceholders: text.match(/\[\[[A-Z0-9_]+\]\]/g) || [],
        img2Len: img2.length,
        img3Len: img3.length,
        sigImagesWritten: img2.length < 200 && img3.length < 200,
      },
      null,
      2,
    ),
  );

  const i = text.indexOf("Electronic Signatures");
  console.log("---SIG ZONE---");
  console.log(text.slice(i, i + 1400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
