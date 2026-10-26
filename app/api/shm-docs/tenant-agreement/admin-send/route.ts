import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  createToken,
  getSignUrl,
  isOwnershipStatement,
  isTenantAgreement,
  logShmEvent,
  validateShmToken,
} from "../../../../../lib/shm/documents";
import { loadTenantAgreementEmailAttachmentsForSend } from "../../../../../lib/shm/tenant-agreement-email-attachments";
import { sendSigningEmail } from "../../../../../lib/shm/mailer";
import {
  signingEmailContentForDocument,
  signingEmailContentForRentalProvider,
} from "../../../../../lib/shm/signing-email-templates";
import {
  isMultiTenantAgreementData,
  rentalProviderFromAgreementData,
} from "../../../../../lib/shm/multi-tenant-signatures";
import {
  markRecipientSigningEmailDelivered,
  markRecipientSigningEmailFailed,
  markTenantSigningEmailDelivered,
  markTenantSigningEmailFailed,
} from "../../../../../lib/shm/tenant-agreement-send";

function collectCreatorIdentity(
  doc: { adminName: string | null; adminEmail: string | null },
  agreementData: Record<string, unknown>,
) {
  return {
    name: String(doc.adminName || agreementData.manager_name || "Property Manager").trim(),
    email: String(doc.adminEmail || agreementData.manager_email || "").trim(),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();
    const doc = await validateShmToken(docId, token);
    if (!doc || doc.adminToken !== token) {
      return NextResponse.json({ message: "Invalid admin signing link" }, { status: 403 });
    }

    const isOwnership = isOwnershipStatement(doc.documentType);
    const recipientName = String(
      body?.tenant_name || body?.owner_name || body?.recipient_name || body?.tenantName || "",
    ).trim();
    const recipientEmail = String(
      body?.tenant_email || body?.owner_email || body?.recipient_email || body?.tenantEmail || "",
    )
      .trim()
      .toLowerCase();
    const adminSignature = String(body?.admin_signature || body?.signature || "").trim();
    const agreementData = (body?.agreement_data || body?.agreementData || {}) as Record<string, unknown>;

    const normalizeList = (value: unknown) => (Array.isArray(value) ? value : []);
    agreementData.core_sections = normalizeList(agreementData.core_sections);
    agreementData.additional_terms = normalizeList(agreementData.additional_terms);
    agreementData.share_house_rules = normalizeList(agreementData.share_house_rules);

    const isSelected = (row: Record<string, unknown>) =>
      row && row.selected !== false && row.selected !== "false" && row.selected !== 0;

    agreementData.core_sections_text = (agreementData.core_sections as Array<Record<string, unknown>>)
      .filter((row) => isSelected(row))
      .map((row) => {
        const title = String(row.title || "").trim();
        const bodyText = String(row.body || row.text || "").trim();
        return title && bodyText ? `${title}\n${bodyText}` : title || bodyText;
      })
      .filter(Boolean)
      .join("\n\n");

    agreementData.additional_terms_text = (agreementData.additional_terms as Array<Record<string, unknown>>)
      .filter((row) => isSelected(row))
      .map((row) => {
        const title = String(row.title || "").trim();
        const bodyText = String(row.body || row.text || "").trim();
        return title && bodyText ? `${title}\n${bodyText}` : title || bodyText;
      })
      .filter(Boolean)
      .join("\n\n");

    agreementData.additional_share_house_rules = (agreementData.share_house_rules as Array<Record<string, unknown>>)
      .filter((row) => isSelected(row) && String(row.text || "").trim())
      .map((row, idx) => `${idx + 1}. ${String(row.text || "").trim()}`)
      .join("\n\n");

    if (!recipientName || !recipientEmail) {
      return NextResponse.json(
        { message: `${isOwnership ? "Owner" : "Tenant"} name and email are required.` },
        { status: 400 },
      );
    }

    const isTenantAgreementDoc = isTenantAgreement(doc.documentType) && !isOwnership;
    if (isTenantAgreementDoc) {
      const landlord = rentalProviderFromAgreementData(agreementData);
      if (!landlord) {
        return NextResponse.json(
          { message: "Landlord / rental provider name and email are required." },
          { status: 400 },
        );
      }
      if (landlord.email === recipientEmail) {
        return NextResponse.json(
          { message: "Landlord email must be different from the tenant email so each party can sign separately." },
          { status: 400 },
        );
      }
    }
    if (!adminSignature && !isTenantAgreementDoc) {
      return NextResponse.json({ message: "Admin signature is required." }, { status: 400 });
    }

    let persistedAgreement: Record<string, unknown> = {};
    try {
      persistedAgreement = doc.agreementData ? (JSON.parse(doc.agreementData) as Record<string, unknown>) : {};
    } catch {
      persistedAgreement = {};
    }
    const isMultiShared =
      isTenantAgreementDoc &&
      isMultiTenantAgreementData({ ...persistedAgreement, ...agreementData });
    if (isMultiShared) {
      agreementData.multi_tenant_send = true;
      if (!agreementData.multi_tenant_recipients && persistedAgreement.multi_tenant_recipients) {
        agreementData.multi_tenant_recipients = persistedAgreement.multi_tenant_recipients;
      }
    }

    const rentalProvider = isTenantAgreementDoc ? rentalProviderFromAgreementData(agreementData) : null;
    const tenantRecipientEmails = new Set<string>();
    if (recipientEmail.includes("@")) tenantRecipientEmails.add(recipientEmail);
    const multiList = agreementData.multi_tenant_recipients;
    if (Array.isArray(multiList)) {
      for (const row of multiList) {
        const item = row as Record<string, unknown>;
        const email = String(item.tenant_email || item.email || "")
          .trim()
          .toLowerCase();
        if (email.includes("@")) tenantRecipientEmails.add(email);
      }
    }
    const dualProviderSign = Boolean(
      rentalProvider && !tenantRecipientEmails.has(rentalProvider.email),
    );
    if (dualProviderSign && rentalProvider) {
      agreementData.rental_provider_dual_sign = true;
      agreementData.rental_provider_signer = { name: rentalProvider.name, email: rentalProvider.email };
    } else {
      agreementData.rental_provider_dual_sign = false;
    }

    const recipientRole = isOwnership ? "Owner" : "Tenant";
    const creatorSigned = Boolean(adminSignature);
    const creatorIdentity = collectCreatorIdentity(doc, agreementData);

    let tenantToken = doc.tenantToken || "";
    const existingTenantSigner = doc.signers.find(
      (s) =>
        s.signerType === "recipient" &&
        (String(s.email || "").toLowerCase() === recipientEmail || s.role === "Tenant"),
    );
    if (!tenantToken) tenantToken = existingTenantSigner?.token || createToken();
    const tenantUrl = getSignUrl(doc.documentId, tenantToken, "recipient");

    let providerUrl: string | null = null;
    let providerToken: string | null = null;
    if (dualProviderSign && rentalProvider) {
      const existingProviderSigner = doc.signers.find(
        (s) => s.signerType === "recipient" && String(s.email || "").toLowerCase() === rentalProvider.email,
      );
      providerToken = existingProviderSigner?.token || createToken();
      providerUrl = getSignUrl(doc.documentId, providerToken, "recipient");
    }

    const tenantSignersForMulti = doc.signers.filter(
      (s) =>
        s.signerType === "recipient" &&
        s.status !== "Removed" &&
        String(s.role || "").toLowerCase() === "tenant",
    );
    const rosterLabel =
      isMultiShared && tenantSignersForMulti.length
        ? tenantSignersForMulti.map((s) => s.name).join(", ")
        : recipientName;

    const statusLabel =
      isMultiShared || dualProviderSign ? "Awaiting Signatures" : `Awaiting ${recipientRole}`;

    await prisma.shmDocument.update({
      where: { documentId: doc.documentId },
      data: {
        status: statusLabel,
        recipientName: rosterLabel,
        recipientEmail,
        recipientRole,
        tenantName: rosterLabel,
        tenantEmail: recipientEmail,
        tenantToken: isMultiShared ? doc.tenantToken : tenantToken,
        tenantSigningUrl: isMultiShared ? doc.tenantSigningUrl : tenantUrl,
        agreementData: JSON.stringify({
          ...agreementData,
          recipientRole,
          recipientName,
          recipientEmail,
        }),
        ...(creatorSigned ? { adminSignature, adminSignedAt: new Date() } : {}),
        adminName: creatorIdentity.name,
        adminEmail: creatorIdentity.email,
      },
    });

    const creatorSignerData = {
      name: creatorIdentity.name,
      email: creatorIdentity.email,
      role: "Creator",
      ...(creatorSigned
        ? { status: "Signed" as const, signature: adminSignature, signedAt: new Date() }
        : { status: "Not Signed" as const, signature: null, signedAt: null }),
    };

    const creatorUpdated = await prisma.shmDocumentSigner.updateMany({
      where: { documentId: doc.documentId, signerType: "creator" },
      data: creatorSignerData,
    });

    if (creatorUpdated.count === 0 && doc.adminToken) {
      await prisma.shmDocumentSigner.create({
        data: {
          id: `${doc.documentId}-creator-${Date.now()}`,
          documentId: doc.documentId,
          signerType: "creator",
          token: doc.adminToken,
          ...creatorSignerData,
        },
      });
    }

    if (!isMultiShared) {
      if (existingTenantSigner) {
        await prisma.shmDocumentSigner.update({
          where: { id: existingTenantSigner.id },
          data: {
            name: recipientName,
            email: recipientEmail,
            role: recipientRole,
            token: tenantToken,
            signingUrl: tenantUrl,
            status: "Not Sent",
            sentAt: null,
          },
        });
      } else {
        await prisma.shmDocumentSigner.create({
          data: {
            id: createToken(),
            documentId: doc.documentId,
            name: recipientName,
            email: recipientEmail,
            role: recipientRole,
            signerType: "recipient",
            token: tenantToken,
            signingUrl: tenantUrl,
            status: "Not Sent",
          },
        });
      }
    } else {
      await prisma.shmDocumentSigner.updateMany({
        where: {
          documentId: doc.documentId,
          signerType: "recipient",
          role: "Tenant",
        },
        data: { status: "Not Sent", sentAt: null },
      });
    }

    if (dualProviderSign && rentalProvider && providerToken && providerUrl) {
      const existingProviderSigner = doc.signers.find(
        (s) => s.signerType === "recipient" && String(s.email || "").toLowerCase() === rentalProvider.email,
      );
      if (existingProviderSigner) {
        await prisma.shmDocumentSigner.update({
          where: { id: existingProviderSigner.id },
          data: {
            name: rentalProvider.name,
            email: rentalProvider.email,
            role: "Rental Provider",
            token: providerToken,
            signingUrl: providerUrl,
            status: "Not Sent",
            sentAt: null,
          },
        });
      } else {
        await prisma.shmDocumentSigner.create({
          data: {
            id: createToken(),
            documentId: doc.documentId,
            name: rentalProvider.name,
            email: rentalProvider.email,
            role: "Rental Provider",
            signerType: "recipient",
            token: providerToken,
            signingUrl: providerUrl,
            status: "Not Sent",
          },
        });
      }
    }

    await logShmEvent(doc.documentId, creatorSigned ? "admin_signed" : "admin_sent_without_signature", request);

    const emailAttachments =
      isTenantAgreement(doc.documentType) && !isOwnership
        ? await loadTenantAgreementEmailAttachmentsForSend({
            documentId: doc.documentId,
            agreementData,
            adminSignature,
            propertyAddress: doc.propertyAddress,
            adminName: creatorIdentity.name,
            adminEmail: creatorIdentity.email,
            tenantName: recipientName,
            tenantEmail: recipientEmail,
          })
        : [];

    const mergedAgreementJson = JSON.stringify({
      ...agreementData,
      recipientRole,
      recipientName,
      recipientEmail,
    });
    const signingEmail = signingEmailContentForDocument(doc.documentType, mergedAgreementJson);

    let tenantEmailResult: { ok: boolean; skipped?: boolean; message?: string } = { ok: false };
    const tenantEmailLinks: Array<{ email: string; url: string; ok: boolean }> = [];

    if (isMultiShared) {
      let allTenantsOk = true;
      for (const signer of tenantSignersForMulti) {
        const signingUrl =
          signer.signingUrl || getSignUrl(doc.documentId, signer.token, "recipient");
        const perTenantAgreement = {
          ...agreementData,
          recipientRole: "Tenant",
          recipientName: signer.name,
          recipientEmail: signer.email,
          tenant_name: signer.name,
          tenant_email: signer.email,
        };
        const attachments = await loadTenantAgreementEmailAttachmentsForSend({
          documentId: doc.documentId,
          agreementData: perTenantAgreement,
          adminSignature,
          propertyAddress: doc.propertyAddress,
          adminName: creatorIdentity.name,
          adminEmail: creatorIdentity.email,
          tenantName: signer.name,
          tenantEmail: signer.email,
        });
        const result = await sendSigningEmail({
          to: signer.email,
          name: signer.name,
          documentType: doc.documentType,
          signingUrl,
          propertyAddress: doc.propertyAddress,
          documentId: doc.documentId,
          creatorEmail: creatorIdentity.email,
          creatorName: creatorIdentity.name,
          attachments: attachments.length ? attachments : undefined,
          signingEmail,
        });
        tenantEmailLinks.push({ email: signer.email, url: signingUrl, ok: Boolean(result.ok) });
        if (result.ok) {
          await markRecipientSigningEmailDelivered(doc.documentId, signer.email);
        } else {
          await markRecipientSigningEmailFailed(doc.documentId, signer.email);
          allTenantsOk = false;
        }
        await logShmEvent(
          doc.documentId,
          result.ok
            ? "recipient_email_sent"
            : result.skipped
              ? "recipient_email_skipped"
              : "recipient_email_error",
          request,
        );
      }
      tenantEmailResult = { ok: allTenantsOk && tenantSignersForMulti.length > 0 };
    } else {
      tenantEmailResult = await sendSigningEmail({
        to: recipientEmail,
        name: recipientName,
        documentType: doc.documentType,
        signingUrl: tenantUrl,
        propertyAddress: doc.propertyAddress,
        documentId: doc.documentId,
        creatorEmail: creatorIdentity.email,
        creatorName: creatorIdentity.name,
        attachments: emailAttachments.length ? emailAttachments : undefined,
        signingEmail,
      });

      await logShmEvent(
        doc.documentId,
        tenantEmailResult.ok
          ? "recipient_email_sent"
          : tenantEmailResult.skipped
            ? "recipient_email_skipped"
            : "recipient_email_error",
        request,
      );
    }

    let providerEmailResult: { ok: boolean; skipped?: boolean; message?: string } | null = null;
    if (dualProviderSign && rentalProvider && providerUrl) {
      const providerSigningEmail = signingEmailContentForRentalProvider(doc.documentType, mergedAgreementJson);
      const providerSalutationName =
        String(agreementData.provider_name || rentalProvider.name || "").trim() || rentalProvider.name;
      providerEmailResult = await sendSigningEmail({
        to: rentalProvider.email,
        name: providerSalutationName,
        documentType: doc.documentType,
        signingUrl: providerUrl,
        propertyAddress: doc.propertyAddress,
        documentId: doc.documentId,
        creatorEmail: creatorIdentity.email,
        creatorName: creatorIdentity.name,
        attachments: emailAttachments.length ? emailAttachments : undefined,
        signingEmail: providerSigningEmail,
      });
      await logShmEvent(
        doc.documentId,
        providerEmailResult.ok
          ? "rental_provider_email_sent"
          : providerEmailResult.skipped
            ? "rental_provider_email_skipped"
            : "rental_provider_email_error",
        request,
      );
    }

    const tenantOk = tenantEmailResult.ok;
    const providerOk = !dualProviderSign || Boolean(providerEmailResult?.ok);

    if (!tenantOk && !isMultiShared) {
      await markTenantSigningEmailFailed(doc.documentId);
      await logShmEvent(
        doc.documentId,
        `recipient_email_error_detail:${String(tenantEmailResult.message || "unknown").slice(0, 200)}`,
        request,
      );
    } else if (tenantOk && !isMultiShared) {
      await markRecipientSigningEmailDelivered(doc.documentId, recipientEmail);
    }

    if (dualProviderSign && rentalProvider) {
      if (providerEmailResult?.ok) {
        await markRecipientSigningEmailDelivered(doc.documentId, rentalProvider.email);
      } else if (providerEmailResult) {
        await markRecipientSigningEmailFailed(doc.documentId, rentalProvider.email);
      }
    }

    if (!tenantOk || !providerOk) {
      return NextResponse.json(
        {
          success: false,
          tenant_url: tenantUrl,
          provider_url: providerUrl,
          recipient_url: tenantUrl,
          email_sent: tenantOk && providerOk,
          tenant_email_sent: tenantOk,
          provider_email_sent: providerOk,
          email_skipped: Boolean(tenantEmailResult.skipped),
          email_error: tenantEmailResult.message || providerEmailResult?.message || "Unknown email error.",
          message: [
            !tenantOk
              ? `Tenant email was not sent: ${tenantEmailResult.message || "Unknown error"}. Link: ${tenantUrl}`
              : "Tenant email sent.",
            dualProviderSign && providerUrl
              ? !providerOk
                ? `Rental provider email was not sent: ${providerEmailResult?.message || "Unknown error"}. Link: ${providerUrl}`
                : "Rental provider email sent."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
        { status: 500 },
      );
    }

    await markTenantSigningEmailDelivered(doc.documentId);
    await logShmEvent(doc.documentId, isOwnership ? "sent_to_owner" : "sent_to_tenant", request);
    if (dualProviderSign) await logShmEvent(doc.documentId, "sent_to_rental_provider", request);

    return NextResponse.json({
      success: true,
      tenant_url: tenantUrl,
      provider_url: providerUrl,
      recipient_url: tenantUrl,
      email_sent: true,
      tenant_email_sent: true,
      provider_email_sent: dualProviderSign,
      email_skipped: false,
      email_attachment: emailAttachments.length > 0,
      message: isMultiShared
        ? `Agreement sent to ${tenantSignersForMulti.length} tenant(s)${dualProviderSign ? " and the rental provider" : ""}. Each signer uses their own email link.`
        : dualProviderSign
          ? "Agreement sent to the renter and Residential Rental Provider. Each party will sign from their own email link."
          : creatorSigned
            ? `Creator signed. ${recipientRole} signing link generated and emailed.`
            : `Agreement sent. ${recipientRole} signing link generated and emailed.`,
      direct_link: tenantUrl,
      tenant_links: isMultiShared ? tenantEmailLinks : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send tenant agreement.";
    console.error("[tenant-agreement/admin-send]", error);
    return NextResponse.json({ success: false, email_sent: false, message }, { status: 500 });
  }
}
