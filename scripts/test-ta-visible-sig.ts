import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { generateTenantAgreementDocx } from "../lib/shm/tenant-agreement-docx";

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";

async function main() {
  const buf = await generateTenantAgreementDocx(
    {
      agreement_date: "2026-07-17",
      provider_name: "hifza",
      provider_email: "info@sharehousemanagers.com.au",
      tenant_name: "beams testing",
      tenant_email: "team@digitechdev.com",
      premises_address: "24 Muir St",
      monthly_rent: "1360",
      weekly_rent: "120",
      bond_amount: "1300",
      bond_payment_due: "2026-07-23",
      commencement_date: "2026-07-16",
      terminate_date: "2026-09-16",
      additional_terms: [{ title: "11. Water", body: "Keep water", selected: true }],
      share_house_rules: [{ text: "Shared house rule", selected: true }],
    },
    {
      documentId: "SHM-VISIBLE-SIG",
      signedAt: new Date("2026-07-16T10:00:00"),
      tenantSignature: tinyPng,
      providerSignature: tinyPng,
    },
  );

  const outPath = path.join("C:/Users/Os/Downloads", `ta-visible-sig-${Date.now()}.docx`);
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
    hasElectronic: text.includes("Electronic Signatures"),
    hasTenantSigDrawing: xml.includes("rIdTaTenantSig"),
    hasProviderSigDrawing: xml.includes("rIdTaProviderSig"),
    hasAuditHeading: text.includes("Audit trail"),
    hasAuditFinalized: text.includes("Document finalized"),
    hasDocId: text.includes("SHM-VISIBLE-SIG"),
    hasTenantName: text.includes("beams testing"),
    hasProviderName: text.includes("hifza"),
    // orphaned rows should be gone from rebuilt section
    leftPlaceholders: text.match(/\[\[[A-Z0-9_]+\]\]/g) || [],
    mediaTenant: Boolean(zip.file("word/media/tenant-signature.png")),
    mediaProvider: Boolean(zip.file("word/media/provider-signature.png")),
  };
  console.log(JSON.stringify(checks, null, 2));

  const i = text.lastIndexOf("Acknowledgement");
  console.log("--- REBUILT BLOCK ---");
  console.log(text.slice(i, i + 1200));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
