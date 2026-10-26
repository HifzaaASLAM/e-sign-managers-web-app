import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { register } = require("tsx/cjs/api");
register();

const { generatePropertyManagementAgreementBuiltDocx } = await import(
  "../lib/shm/property-management-agreement-built-docx.ts"
);

/** Same field values as dashboard export: Property-Management-Agreement-teams-2026-10-22.docx */
const teamsData = {
  property: "13, Dewberry Street, Manor Lakes, Melbourne, Victoria, 3024, Australia",
  owner: "teams",
  email: "team@digitechdev.com",
  deposit_to: "teams",
  repairs: "Refer to landlord for advice",
  asbestos: "Unknown",
  rates_general: "No",
  rates_water: "No",
  land_tax: "No",
  body_corp: "No",
  fair_clause: "No",
  email_statements: "No",
  pets: "No",
  groups: "No",
  owner_sign_name: "teams",
  sig_date: "22/10/2026",
  agent_sign_name: "digitechdev",
  agent_sig_date: "22/10/2026",
  submittedAt: "22/10/2026, 4:41:19 pm",
};

const buf = await generatePropertyManagementAgreementBuiltDocx(teamsData, {});

const outDocx =
  "C:/Users/Os/Downloads/Property-Management-Agreement-teams-LAYOUT-PREVIEW-v6-full-flow-2026-10-22.docx";
fs.writeFileSync(outDocx, buf);
console.log("Wrote preview:", outDocx, "bytes", buf.length);
