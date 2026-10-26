import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  isPropertyManagementAgreement,
  isTenantAgreement,
  logShmEvent,
  validateShmToken,
  signerRoleForToken,
} from "../../../../lib/shm/documents";
import { normalizePmaAgreementStorage } from "../../../../lib/shm/property-management-agreement-fields";
import { sanitizeTenantAgreementLandlordFields } from "../../../../lib/shm/ta-templates";

export const dynamic = "force-dynamic";

function parseStoredAgreement(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Only unfinished creator work can stay / become Draft. Sent docs must never revert. */
function isDraftEditableStatus(status: string | null | undefined) {
  const value = String(status || "").trim();
  if (!value) return true;
  if (value === "Draft" || value === "Waiting" || value === "Not Signed") return true;
  if (value === "Awaiting Creator Signature") return true;
  return false;
}

function isAlreadySentDocument(doc: {
  status: string;
  sentAt: Date | null;
  tenantSentAt: Date | null;
  adminSignedAt: Date | null;
}) {
  if (doc.sentAt || doc.tenantSentAt || doc.adminSignedAt) return true;
  return !isDraftEditableStatus(doc.status);
}

/** Save creator progress without sending — keeps document as Draft until send. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();
    const agreementPatch =
      body?.agreement_data && typeof body.agreement_data === "object" && !Array.isArray(body.agreement_data)
        ? (body.agreement_data as Record<string, unknown>)
        : body?.field_values && typeof body.field_values === "object" && !Array.isArray(body.field_values)
          ? (body.field_values as Record<string, unknown>)
          : {};

    if (!docId || !token) {
      return NextResponse.json({ ok: false, message: "Missing doc_id or token." }, { status: 400 });
    }

    const doc = await validateShmToken(docId, token);
    if (!doc) {
      return NextResponse.json({ ok: false, message: "Invalid document or token." }, { status: 403 });
    }

    const activeSigner = doc.signers.find((s) => s.token === token) || null;
    const role = activeSigner?.signerType || signerRoleForToken(doc, token);
    const isCreatorToken = role === "creator" || Boolean(doc.adminToken && doc.adminToken === token);

    if (!isCreatorToken) {
      return NextResponse.json({ ok: false, message: "Only the creator can save a draft." }, { status: 403 });
    }

    const existing = parseStoredAgreement(doc.agreementData);

    const creatorSigner = doc.signers.find((s) => s.signerType === "creator");
    const creatorCanRefreshPma =
      isPropertyManagementAgreement(doc.documentType)
      && isCreatorToken
      && creatorSigner
      && creatorSigner.status !== "Signed";

    if (isAlreadySentDocument(doc) && !creatorCanRefreshPma) {
      return NextResponse.json({
        ok: false,
        message: "This document was already sent. Open it from the dashboard if you need to continue.",
      }, { status: 409 });
    }
    // Never persist huge/binary blobs from accidental field dumps into draft.
    const cleanedPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(agreementPatch)) {
      if (value == null) continue;
      if (typeof value === "string" && value.startsWith("data:") && value.length > 50000) continue;
      if (key === "last_submission" || key === "fileContent" || key === "pdfFileContent" || key === "docxFileContent") continue;
      cleanedPatch[key] = value;
    }

    let merged: Record<string, unknown> = {
      ...existing,
      ...cleanedPatch,
      draft_saved_at: new Date().toISOString(),
      is_draft: !isAlreadySentDocument(doc),
    };

    if (isPropertyManagementAgreement(doc.documentType)) {
      merged = normalizePmaAgreementStorage(merged);
    }
    if (isTenantAgreement(doc.documentType)) {
      merged = sanitizeTenantAgreementLandlordFields(merged, {
        adminName: doc.adminName,
        adminEmail: doc.adminEmail,
      });
    }

    const premises = String(
      cleanedPatch.premises_address ||
        cleanedPatch.property_address ||
        cleanedPatch.propertyAddress ||
        "",
    ).trim();
    const recipientName = String(
      cleanedPatch.tenant_name ||
        cleanedPatch.tenant_name_field ||
        cleanedPatch.owner_name ||
        cleanedPatch.recipientName ||
        "",
    ).trim();
    const recipientEmail = String(
      cleanedPatch.tenant_email ||
        cleanedPatch.tenant_email_field ||
        cleanedPatch.owner_email ||
        cleanedPatch.recipientEmail ||
        "",
    )
      .trim()
      .toLowerCase();

    // Re-check immediately before write so a concurrent send cannot be overwritten as Draft.
    const latest = await prisma.shmDocument.findUnique({
      where: { documentId: doc.documentId },
      select: {
        status: true,
        sentAt: true,
        tenantSentAt: true,
        adminSignedAt: true,
      },
    });
    if (!latest || (isAlreadySentDocument(latest) && !creatorCanRefreshPma)) {
      return NextResponse.json({
        ok: false,
        message: "This document was already sent. Open it from the dashboard if you need to continue.",
      }, { status: 409 });
    }

    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: {
        agreementData: JSON.stringify(merged),
        ...(isDraftEditableStatus(latest.status) && !isAlreadySentDocument(latest) ? { status: "Draft" } : {}),
        ...(premises ? { propertyAddress: premises } : {}),
        ...(recipientName
          ? {
              recipientName,
              tenantName: recipientName,
            }
          : {}),
        ...(recipientEmail
          ? {
              recipientEmail,
              tenantEmail: recipientEmail,
            }
          : {}),
      },
    });

    if (recipientName || recipientEmail) {
      await prisma.shmDocumentSigner.updateMany({
        where: { documentId: doc.documentId, signerType: "recipient" },
        data: {
          ...(recipientName ? { name: recipientName } : {}),
          ...(recipientEmail ? { email: recipientEmail } : {}),
        },
      });
    }

    await logShmEvent(doc.documentId, "draft_saved", request);

    return NextResponse.json({
      ok: true,
      status: "Draft",
      message: "Draft saved. You can leave and continue later from the dashboard.",
      savedAt: merged.draft_saved_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save draft.";
    console.error("[shm-docs/save-draft]", message);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
