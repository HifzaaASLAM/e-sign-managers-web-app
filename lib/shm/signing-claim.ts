import { prisma } from "../prisma";

/** Atomically claim a signer as Signed. Returns false if already signed (or missing). */
export async function claimSignerSigned(input: {
  signerId: string;
  signature: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const result = await prisma.shmDocumentSigner.updateMany({
    where: {
      id: input.signerId,
      status: { not: "Signed" },
    },
    data: {
      status: "Signed",
      signature: input.signature,
      signedAt: new Date(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
  return result.count > 0;
}

/** Strip huge base64 blobs before persisting agreementData / sending to the browser. */
export function stripHeavyAgreementBlobs(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const heavyKeys = [
    "fileContent",
    "file_content",
    "pdfFileContent",
    "docxContent",
    "docx_content",
    "signature",
    "tenant_signature",
    "owner_signature",
    "recipient_signature",
    "admin_signature",
    "multi_tenant_combined_b64",
  ];

  for (const key of heavyKeys) {
    if (typeof out[key] === "string" && (out[key] as string).length > 500) {
      out[key] = `[omitted ${((out[key] as string).length / 1024).toFixed(0)}kb]`;
    }
  }

  const submissionFileKeys = [
    "fileContent",
    "file_content",
    "pdfFileContent",
    "docxFileContent",
    "docxContent",
    "docx_content",
  ] as const;

  const last = out.last_submission;
  if (last && typeof last === "object" && !Array.isArray(last)) {
    const lastObj = { ...(last as Record<string, unknown>) };
    const preservedSubmissionFiles: Record<string, unknown> = {};
    for (const key of submissionFileKeys) {
      const value = lastObj[key];
      if (typeof value === "string" && value.length > 0) {
        preservedSubmissionFiles[key] = value;
        delete lastObj[key];
      }
    }
    out.last_submission = {
      ...stripHeavyAgreementBlobs(lastObj),
      ...preservedSubmissionFiles,
    };
  }

  const fieldValues = out.field_values;
  if (fieldValues && typeof fieldValues === "object" && !Array.isArray(fieldValues)) {
    const cleaned: Record<string, unknown> = { ...(fieldValues as Record<string, unknown>) };
    for (const key of Object.keys(cleaned)) {
      const value = cleaned[key];
      if (typeof value === "string" && value.length > 2000 && /^(data:|iVBOR|JVBER|UEsDB)/.test(value)) {
        cleaned[key] = `[omitted ${((value.length) / 1024).toFixed(0)}kb]`;
      }
    }
    out.field_values = cleaned;
  }

  return out;
}
