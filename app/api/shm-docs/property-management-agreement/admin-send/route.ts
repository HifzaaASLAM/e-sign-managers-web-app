import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  createToken,
  getSignUrl,
  isPropertyManagementAgreement,
  logShmEvent,
  validateShmToken,
} from "../../../../../lib/shm/documents";
import { parsePmaSendContacts, splitPmaSendContacts } from "../../../../../lib/shm/pma-send-contacts";
import {
  buildPmaOwnerResendSigningLink,
  mergePmaAgreementForOwnerResend,
} from "../../../../../lib/shm/pma-owner-resend";
import { ensureAdminDocumentInlineViewUrl } from "../../../../../lib/shm/admin-document-download";
import { sendPmaDocumentViewOnlyEmail, sendSigningEmail } from "../../../../../lib/shm/mailer";
import { signingEmailContentForDocument } from "../../../../../lib/shm/signing-email-templates";
import {
  mergePmaFieldValues,
  parsePmaAgreementData,
} from "../../../../../lib/shm/property-management-agreement-fields";
import {
  markTenantSigningEmailDelivered,
  markTenantSigningEmailFailed,
} from "../../../../../lib/shm/tenant-agreement-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();

    if (!docId || !token) {
      return NextResponse.json({ message: "Missing doc_id or token." }, { status: 400 });
    }

    const doc = await validateShmToken(docId, token);
    if (!doc) {
      return NextResponse.json({ message: "Invalid document or token." }, { status: 403 });
    }

    if (!isPropertyManagementAgreement(doc.documentType)) {
      return NextResponse.json({ message: "This endpoint is only for Property Management Agreement documents." }, { status: 400 });
    }

    const creatorSigner = doc.signers.find((s) => s.signerType === "creator");
    const isCreatorToken =
      doc.adminToken === token
      || creatorSigner?.token === token
      || Boolean(creatorSigner && creatorSigner.token === token);

    if (!isCreatorToken) {
      return NextResponse.json({ message: "Only the agency (creator) can send this agreement to the owner." }, { status: 403 });
    }

    const incoming = parsePmaAgreementData(body?.agreement_data || body?.field_values);
    const fallbackOwnerName = String(
      body?.owner_name
        || incoming.owner_sign_name
        || incoming.pma_owner_sign_name
        || incoming.owner
        || incoming.pma_owner
        || doc.recipientName
        || "",
    ).trim();
    const fallbackOwnerEmail = String(
      body?.owner_email
        || incoming.email
        || incoming.pma_email
        || doc.recipientEmail
        || "",
    )
      .trim()
      .toLowerCase();

    const sendContacts = parsePmaSendContacts(
      body?.send_contacts ?? incoming.pma_send_contacts,
      { name: fallbackOwnerName, email: fallbackOwnerEmail, role: "Owner" },
    );
    const { primary, additionalSigners, ccContacts, ccEmails } = splitPmaSendContacts(sendContacts);

    if (!primary || !primary.email.includes("@")) {
      return NextResponse.json(
        { message: "At least one signer with a valid name and email is required." },
        { status: 400 },
      );
    }

    const ownerName = primary.name;
    const ownerEmail = primary.email;
    const primaryRole = primary.role || "Owner";

    const propertyAddress = String(
      incoming.property
        || incoming.pma_property
        || doc.propertyAddress
        || "",
    ).trim();

    const stored = parsePmaAgreementData(doc.agreementData);
    const mergedFields = mergePmaFieldValues(stored, incoming);
    const agreementPayload = mergePmaAgreementForOwnerResend(doc.agreementData, {
      ...mergedFields,
      owner: ownerName,
      pma_owner: ownerName,
      owner_sign_name: ownerName,
      pma_owner_sign_name: ownerName,
      email: ownerEmail,
      pma_email: ownerEmail,
      property: propertyAddress || mergedFields.property,
      pma_property: propertyAddress || mergedFields.pma_property,
      pma_send_contacts: sendContacts,
    });

    const { recipientToken, signingUrl } = buildPmaOwnerResendSigningLink(doc.documentId);
    const agreementDataJson = JSON.stringify(agreementPayload);
    const signingEmail = signingEmailContentForDocument(doc.documentType, agreementDataJson);

    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: {
        recipientName: ownerName,
        recipientEmail: ownerEmail,
        recipientRole: primaryRole,
        tenantName: ownerName,
        tenantEmail: ownerEmail,
        propertyAddress: propertyAddress || doc.propertyAddress,
        token: recipientToken,
        tenantToken: recipientToken,
        signingUrl,
        tenantSigningUrl: signingUrl,
        agreementData: agreementDataJson,
        tenantSignature: null,
        tenantSignedAt: null,
        signedAt: null,
      },
    });

    const recipientRows = doc.signers.filter((s) => s.signerType === "recipient");
    const primarySignerRow =
      recipientRows.find((s) => s.status !== "Removed") || recipientRows[0];

    if (primarySignerRow) {
      await prisma.shmDocumentSigner.update({
        where: { id: primarySignerRow.id },
        data: {
          name: ownerName,
          email: ownerEmail,
          role: primaryRole,
          token: recipientToken,
          signingUrl,
          status: "Waiting",
          sentAt: null,
          signature: null,
          signedAt: null,
          viewedAt: null,
        },
      });
    }

    const emailResult = await sendSigningEmail({
      to: ownerEmail,
      name: ownerName,
      documentType: doc.documentType,
      signingUrl,
      propertyAddress: propertyAddress || doc.propertyAddress,
      documentId: doc.documentId,
      creatorEmail: doc.adminEmail,
      creatorName: doc.adminName,
      signingEmail,
    });

    const ccEmailFailures: string[] = [];
    if (ccContacts.length) {
      const viewUrl = (await ensureAdminDocumentInlineViewUrl(doc.documentId)) || "";
      for (const contact of ccContacts) {
        if (contact.email === ownerEmail) continue;
        const existingCcSigner = doc.signers.find(
          (s) =>
            s.signerType === "recipient"
            && s.email.toLowerCase() === contact.email
            && s.id !== primarySignerRow?.id,
        );
        if (existingCcSigner) {
          await prisma.shmDocumentSigner.update({
            where: { id: existingCcSigner.id },
            data: { status: "Removed" },
          });
        }
        if (!viewUrl) {
          ccEmailFailures.push(contact.email);
          continue;
        }
        const ccResult = await sendPmaDocumentViewOnlyEmail({
          to: contact.email,
          name: contact.name,
          documentType: doc.documentType,
          documentId: doc.documentId,
          propertyAddress: propertyAddress || doc.propertyAddress,
          viewUrl,
          role: contact.role,
          primarySignerName: ownerName,
        });
        if (!ccResult.ok) {
          ccEmailFailures.push(contact.email);
        }
      }
    }

    const extraEmailFailures: string[] = [];
    for (const contact of additionalSigners) {
      if (contact.email === ownerEmail) continue;
      const extraToken = createToken();
      const extraSigningUrl = getSignUrl(doc.documentId, extraToken, "recipient");
      const existing = doc.signers.find(
        (s) => s.signerType === "recipient" && s.email.toLowerCase() === contact.email,
      );
      if (existing && existing.id !== primarySignerRow?.id) {
        await prisma.shmDocumentSigner.update({
          where: { id: existing.id },
          data: {
            name: contact.name,
            email: contact.email,
            role: contact.role || "Owner",
            token: extraToken,
            signingUrl: extraSigningUrl,
            status: "Waiting",
            sentAt: new Date(),
            signature: null,
            signedAt: null,
            viewedAt: null,
          },
        });
      } else if (!existing) {
        await prisma.shmDocumentSigner.create({
          data: {
            id: createToken(),
            documentId: doc.documentId,
            name: contact.name,
            email: contact.email,
            role: contact.role || "Owner",
            signerType: "recipient",
            token: extraToken,
            signingUrl: extraSigningUrl,
            status: "Waiting",
            sentAt: new Date(),
          },
        });
      }
      const extraResult = await sendSigningEmail({
        to: contact.email,
        name: contact.name,
        documentType: doc.documentType,
        signingUrl: extraSigningUrl,
        propertyAddress: propertyAddress || doc.propertyAddress,
        documentId: doc.documentId,
        creatorEmail: doc.adminEmail,
        creatorName: doc.adminName,
        signingEmail,
      });
      if (!extraResult.ok) {
        extraEmailFailures.push(contact.email);
      }
    }

    await logShmEvent(
      doc.documentId,
      emailResult.ok ? "recipient_email_sent" : emailResult.skipped ? "recipient_email_skipped" : "recipient_email_error",
      request,
    );

    if (!emailResult.ok) {
      await markTenantSigningEmailFailed(doc.documentId);
      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: { status: doc.status === "Signed" || doc.status === "Processing" ? doc.status : "Draft" },
      });
      return NextResponse.json({
        success: false,
        ok: false,
        message: emailResult.message || "Could not send signing email. Check RESEND_API_KEY and EMAIL_FROM, then try Re-send from the dashboard.",
        signingUrl,
      }, { status: emailResult.skipped ? 503 : 500 });
    }

    await markTenantSigningEmailDelivered(doc.documentId);
    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: { status: "Sent" },
    });
    await logShmEvent(doc.documentId, "pma_sent_to_owner", request);

    const ccNote =
      ccEmails.length && ccEmailFailures.length === 0
        ? ` View copy sent to: ${ccEmails.join(", ")}.`
        : ccEmails.length
          ? ` View copy: ${ccEmails.filter((e) => !ccEmailFailures.includes(e)).join(", ") || "none"}${ccEmailFailures.length ? ` (failed: ${ccEmailFailures.join(", ")})` : ""}.`
          : "";
    const extraNote =
      additionalSigners.length > 0
        ? ` Additional signers: ${additionalSigners.map((c) => c.email).join(", ")}.`
        : "";
    const failNote =
      extraEmailFailures.length > 0
        ? ` Could not email: ${extraEmailFailures.join(", ")}.`
        : "";

    return NextResponse.json({
      success: true,
      ok: true,
      message: `Property Management Agreement sent to ${ownerEmail}.${ccNote}${extraNote}${failNote}`,
      signingUrl,
      recipientEmail: ownerEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send Property Management Agreement.";
    console.error("[property-management-agreement/admin-send]", message, error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
