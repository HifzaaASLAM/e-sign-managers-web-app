import { generatePropertyManagementAgreementPdfBase64 } from "../lib/shm/property-management-agreement-export.ts";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const data = {
  owner: "hifza",
  owner_sign_name: "hifza",
  sig_date: "2026-10-13",
  term_duties: "Line1\nLine2",
  pma_term_appointment: 'Test & <xml> "quotes"',
};

async function main() {
  const r = await generatePropertyManagementAgreementPdfBase64(data, {
    ownerSignature: "",
    agentSignature: png,
  });
  console.log("ok", r.base64.length);
}

main().catch((e) => {
  console.error("fail", e);
  process.exit(1);
});
