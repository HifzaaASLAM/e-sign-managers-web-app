import { generatePropertyManagementAgreementDocx } from "./property-management-agreement-docx";

/** Fills the pixel-perfect professional Word template (your attached reference layout). */
export async function generatePropertyManagementAgreementBuiltDocx(
  data: Record<string, unknown>,
  options?: { ownerSignature?: string; agentSignature?: string },
) {
  return generatePropertyManagementAgreementDocx(data, options);
}

export { buildPropertyManagementAgreementTemplateData } from "./property-management-agreement-docx";
