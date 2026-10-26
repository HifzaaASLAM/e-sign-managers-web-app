import { NextResponse } from "next/server";
import { validateShmSignerToken } from "../../../../../lib/shm/documents";
import { mergePmaFieldValues, parsePmaAgreementData } from "../../../../../lib/shm/property-management-agreement-fields";
import { generatePropertyManagementAgreementPdfBase64 } from "../../../../../lib/shm/property-management-agreement-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function readStoredSignature(agreementData: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = String(agreementData[key] || "").trim();
    if (value) return value;
  }

  const fieldValues = agreementData.field_values;
  if (fieldValues && typeof fieldValues === "object") {
    for (const key of keys) {
      const value = String((fieldValues as Record<string, unknown>)[key] || "").trim();
      if (value) return value;
    }
  }

  const lastSubmission = agreementData.last_submission;
  if (lastSubmission && typeof lastSubmission === "object") {
    for (const key of keys) {
      const value = String((lastSubmission as Record<string, unknown>)[key] || "").trim();
      if (value) return value;
    }
  }

  return "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();
    const signerType = String(body?.signer_type || body?.signer_role || "").trim().toLowerCase();
    const isCreator = signerType === "creator";

    if (!docId || !token) {
      return NextResponse.json({ message: "Missing doc_id or token." }, { status: 400 });
    }

    const validation = await validateShmSignerToken(docId, token);
    if (!validation?.document) {
      return NextResponse.json({ message: "Invalid document or token." }, { status: 403 });
    }

    const doc = validation.document;
    const stored = parsePmaAgreementData(doc.agreementData);
    const incoming = parsePmaAgreementData(body?.agreement_data || body?.field_values);
    const mergedData = mergePmaFieldValues(stored, incoming);
    mergedData.email = mergedData.email || doc.recipientEmail;
    mergedData.owner = mergedData.owner || mergedData.owner_sign_name || doc.recipientName;

    const activeSignature = String(
      body?.signature || body?.owner_signature || body?.tenant_signature || incoming.signature || "",
    ).trim();
    const storedOwnerSignature = readStoredSignature(stored, [
      "signature",
      "pma_sig",
      "owner_signature",
    ]);
    const incomingOwnerSignature = readStoredSignature(incoming, [
      "signature",
      "pma_sig",
      "owner_signature",
    ]);
    const bodyOwnerSignature = String(body?.owner_signature || "").trim();
    const ownerSignature = isCreator
      ? bodyOwnerSignature || storedOwnerSignature || incomingOwnerSignature
      : activeSignature;
    const agentSignature = isCreator
      ? String(body?.agent_signature || body?.admin_signature || activeSignature || "").trim()
      : "";

    const generated = await generatePropertyManagementAgreementPdfBase64(mergedData, {
      ownerSignature,
      agentSignature,
    });

    return NextResponse.json({
      ok: true,
      fileContent: generated.base64,
      fileType: generated.mimeType,
      isPdf: generated.isPdf,
      docxContent: generated.docxBase64,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate property management agreement document.";
    console.error("[property-management-agreement/generate-pdf]", message, error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
