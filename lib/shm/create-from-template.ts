import { prisma } from "../prisma";
import {
  createToken,
  getSignUrl,
  isTenantAgreement,
  logShmEvent,
  nextShmDocumentId,
} from "./documents";
import { cloneTemplateDataForNewAgreement, parseTemplateAgreementData } from "./ta-templates";
import { sendSigningEmail } from "./mailer";
import {
  markTenantSigningEmailDelivered,
  markTenantSigningEmailFailed,
} from "./tenant-agreement-send";
import { loadTenantAgreementEmailAttachmentsForSend } from "./tenant-agreement-email-attachments";
import {
  mergeSigningEmailPatchIntoJson,
  signingEmailContentForDocument,
} from "./signing-email-templates";
import { parseRecipientLines, type BulkRecipient } from "./recipient-lines";

export type TemplateRecipient = {
  tenant_name: string;
  tenant_email: string;
  premises_address?: string;
};

function bulkToTemplateRecipient(r: BulkRecipient): TemplateRecipient {
  return {
    tenant_name: r.name,
    tenant_email: r.email,
    premises_address: r.propertyAddress,
  };
}

export { parseRecipientLines, bulkToTemplateRecipient };

export async function createTenantAgreementFromTemplate(input: {
  companyId: string;
  user: { id: string; name?: string | null; email: string };
  template: { agreementData: string | null };
  recipient: TemplateRecipient;
  request?: Request;
  signingEmailSubject?: string | null;
  signingEmailBody?: string | null;
}) {
  const tenantName = String(input.recipient.tenant_name || "").trim();
  const tenantEmail = String(input.recipient.tenant_email || "").trim().toLowerCase();
  const premisesAddress = String(input.recipient.premises_address || "").trim();

  if (!tenantName || !tenantEmail) {
    throw new Error("Tenant name and email are required.");
  }

  const agreementData = cloneTemplateDataForNewAgreement(input.template.agreementData, {
    tenant_name: tenantName,
    tenant_email: tenantEmail,
    premises_address: premisesAddress || undefined,
  });

  const agreementDataWithEmail = JSON.parse(
    mergeSigningEmailPatchIntoJson(
      JSON.stringify(agreementData),
      "Tenant Agreement",
      input.signingEmailSubject,
      input.signingEmailBody,
    ),
  ) as Record<string, unknown>;

  const documentId = await nextShmDocumentId();
  const recipientToken = createToken();
  const creatorToken = createToken();
  const signingUrl = getSignUrl(documentId, recipientToken, "recipient");
  const creatorSigningUrl = getSignUrl(documentId, creatorToken, "creator");
  const propertyAddress = String(agreementDataWithEmail.premises_address || premisesAddress || "").trim();

  await prisma.shmDocument.create({
    data: {
      companyId: input.companyId,
      createdById: input.user.id,
      documentId,
      documentType: "Tenant Agreement",
      recipientName: tenantName,
      recipientEmail: tenantEmail,
      recipientRole: "Tenant",
      propertyAddress,
      status: "Draft",
      token: recipientToken,
      adminToken: creatorToken,
      tenantToken: recipientToken,
      signingUrl,
      tenantSigningUrl: signingUrl,
      adminName: input.user.name || "Admin",
      adminEmail: input.user.email,
      tenantName,
      tenantEmail,
      agreementData: JSON.stringify(agreementDataWithEmail),
      sentAt: null,
    },
  });

  await prisma.shmDocumentSigner.createMany({
    data: [
      {
        id: createToken(),
        documentId,
        name: input.user.name || "Admin",
        email: input.user.email,
        role: "Property Manager",
        signerType: "creator",
        token: creatorToken,
        signingUrl: creatorSigningUrl,
        status: "Awaiting Signature",
      },
      {
        id: createToken(),
        documentId,
        name: tenantName,
        email: tenantEmail,
        role: "Tenant",
        signerType: "recipient",
        token: recipientToken,
        signingUrl,
        status: "Not Sent",
      },
    ],
  });

  if (input.request) {
    await logShmEvent(documentId, "Document Created", input.request);
  }

  return {
    documentId,
    creatorSigningUrl,
    signingUrl,
    tenantName,
    tenantEmail,
    propertyAddress,
    agreementData,
    creatorToken,
  };
}

/** Apply creator signature and email the tenant signing link. */
export async function sendCreatedAgreementToTenant(input: {
  documentId: string;
  creatorToken: string;
  tenantName: string;
  tenantEmail: string;
  propertyAddress?: string;
  agreementData: Record<string, unknown>;
  adminSignature?: string;
  adminName: string;
  adminEmail: string;
  request?: Request;
}) {
  const adminSignature = String(input.adminSignature || "").trim();

  const agreementData = { ...input.agreementData };
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
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_terms_text = (agreementData.additional_terms as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row))
    .map((row) => {
      const title = String(row.title || "").trim();
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_share_house_rules = (agreementData.share_house_rules as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row) && String(row.text || "").trim())
    .map((row, idx) => `${idx + 1}. ${String(row.text || "").trim()}`)
    .join("\n\n");

  const doc = await prisma.shmDocument.findUnique({ where: { documentId: input.documentId } });
  if (!doc || doc.adminToken !== input.creatorToken) {
    throw new Error("Invalid document for send.");
  }
  const signingUrl = getSignUrl(input.documentId, doc.tenantToken || doc.token || "", "recipient");

  await prisma.shmDocument.update({
    where: { documentId: input.documentId },
    data: {
      status: adminSignature ? "Awaiting Tenant" : "Awaiting Creator Signature",
      recipientName: input.tenantName,
      recipientEmail: input.tenantEmail,
      recipientRole: "Tenant",
      tenantName: input.tenantName,
      tenantEmail: input.tenantEmail,
      tenantSigningUrl: signingUrl,
      agreementData: JSON.stringify({
        ...agreementData,
        recipientRole: "Tenant",
        recipientName: input.tenantName,
        recipientEmail: input.tenantEmail,
        tenant_name: input.tenantName,
        tenant_email: input.tenantEmail,
      }),
      ...(adminSignature
        ? { adminSignature, adminSignedAt: new Date() }
        : {}),
      adminName: input.adminName,
      adminEmail: input.adminEmail,
    },
  });

  if (adminSignature) {
    await prisma.shmDocumentSigner.updateMany({
      where: { documentId: input.documentId, signerType: "creator" },
      data: {
        name: input.adminName,
        email: input.adminEmail,
        role: "Creator",
        status: "Signed",
        signature: adminSignature,
        signedAt: new Date(),
      },
    });
  } else {
    await prisma.shmDocumentSigner.updateMany({
      where: { documentId: input.documentId, signerType: "creator" },
      data: {
        name: input.adminName,
        email: input.adminEmail,
        role: "Creator",
      },
    });
  }

  await prisma.shmDocumentSigner.updateMany({
    where: { documentId: input.documentId, signerType: "recipient" },
    data: {
      name: input.tenantName,
      email: input.tenantEmail,
      role: "Tenant",
      signingUrl,
      status: "Not Sent",
      sentAt: null,
    },
  });

  if (input.request) {
    await logShmEvent(input.documentId, adminSignature ? "admin_signed" : "sent_without_creator_signature", input.request);
  }

  const emailAttachments = await loadTenantAgreementEmailAttachmentsForSend({
    documentId: input.documentId,
    agreementData,
    adminSignature,
    propertyAddress: input.propertyAddress || doc.propertyAddress,
    adminName: input.adminName,
    adminEmail: input.adminEmail,
    tenantName: input.tenantName,
    tenantEmail: input.tenantEmail,
  });

  const signingEmail = signingEmailContentForDocument("Tenant Agreement", doc.agreementData);
  const emailResult = await sendSigningEmail({
    to: input.tenantEmail,
    name: input.tenantName,
    documentType: "Tenant Agreement",
    signingUrl,
    propertyAddress: input.propertyAddress || doc.propertyAddress || undefined,
    documentId: input.documentId,
    creatorEmail: doc.adminEmail,
    creatorName: doc.adminName,
    attachments: emailAttachments.length ? emailAttachments : undefined,
    signingEmail,
  });

  if (input.request) {
    await logShmEvent(
      input.documentId,
      emailResult.ok ? "recipient_email_sent" : emailResult.skipped ? "recipient_email_skipped" : "recipient_email_error",
      input.request,
    );
  }

  if (emailResult.ok) {
    await markTenantSigningEmailDelivered(input.documentId);
    if (input.request) {
      await logShmEvent(input.documentId, "sent_to_tenant", input.request);
    }
  } else {
    await markTenantSigningEmailFailed(input.documentId);
  }

  return { signingUrl, emailResult };
}

function normalizeAgreementLists(agreementData: Record<string, unknown>) {
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
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_terms_text = (agreementData.additional_terms as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row))
    .map((row) => {
      const title = String(row.title || "").trim();
      const body = String(row.body || row.text || "").trim();
      return title && body ? `${title}\n${body}` : title || body;
    })
    .filter(Boolean)
    .join("\n\n");

  agreementData.additional_share_house_rules = (agreementData.share_house_rules as Array<Record<string, unknown>>)
    .filter((row) => isSelected(row) && String(row.text || "").trim())
    .map((row, idx) => `${idx + 1}. ${String(row.text || "").trim()}`)
    .join("\n\n");

  return agreementData;
}

/** One Tenant Agreement shared by multiple tenants — each gets their own signing link. */
export async function createMultiTenantAgreementFromTemplate(input: {
  companyId: string;
  user: { id: string; name?: string | null; email: string };
  template?: { agreementData: string | null } | null;
  recipients: TemplateRecipient[];
  landlord?: { name: string; email: string } | null;
  request?: Request;
  signingEmailSubject?: string | null;
  signingEmailBody?: string | null;
}) {
  const recipients = input.recipients.filter((r) => r.tenant_name && r.tenant_email.includes("@"));
  if (recipients.length < 2) {
    throw new Error("At least two tenants are required for a multi-tenant agreement.");
  }

  const templateRaw = input.template?.agreementData ?? null;
  const templateData = parseTemplateAgreementData(templateRaw);
  const premisesAddress =
    String(recipients.find((r) => r.premises_address)?.premises_address || "").trim() ||
    String(templateData.premises_address || "").trim();

  const rosterLabel = recipients.map((r) => r.tenant_name).join(", ");
  let agreementData: Record<string, unknown> = templateRaw
    ? cloneTemplateDataForNewAgreement(templateRaw, {
        tenant_name: rosterLabel,
        tenant_email: recipients.map((r) => r.tenant_email).join(", "),
        premises_address: premisesAddress || undefined,
      })
    : {
        premises_address: premisesAddress || undefined,
        tenant_name: rosterLabel,
        tenant_email: recipients.map((r) => r.tenant_email).join(", "),
      };
  agreementData.multi_tenant_send = true;
  agreementData.multi_tenant_recipients = recipients.map((r) => ({
    tenant_name: r.tenant_name,
    tenant_email: r.tenant_email,
    premises_address: r.premises_address || premisesAddress || undefined,
  }));

  const landlordName = String(input.landlord?.name || "").trim();
  const landlordEmail = String(input.landlord?.email || "").trim().toLowerCase();
  const landlord =
    landlordName && landlordEmail.includes("@")
      ? { name: landlordName, email: landlordEmail }
      : null;
  if (landlord) {
    agreementData.multi_tenant_landlord = landlord;
    agreementData.landlord_name = landlord.name;
    agreementData.landlord_email = landlord.email;
  }

  const agreementDataWithEmail = JSON.parse(
    mergeSigningEmailPatchIntoJson(
      JSON.stringify(agreementData),
      "Tenant Agreement",
      input.signingEmailSubject,
      input.signingEmailBody,
    ),
  ) as Record<string, unknown>;

  const documentId = await nextShmDocumentId();
  const creatorToken = createToken();
  const legacyToken = createToken();
  const creatorSigningUrl = getSignUrl(documentId, creatorToken, "creator");

  const recipientSigners = recipients.map((recipient) => {
    const token = createToken();
    return {
      recipient,
      role: "Tenant" as const,
      token,
      signingUrl: getSignUrl(documentId, token, "recipient"),
    };
  });
  if (landlord) {
    const token = createToken();
    recipientSigners.push({
      recipient: {
        tenant_name: landlord.name,
        tenant_email: landlord.email,
        premises_address: premisesAddress || undefined,
      },
      role: "Landlord",
      token,
      signingUrl: getSignUrl(documentId, token, "recipient"),
    });
  }

  await prisma.shmDocument.create({
    data: {
      companyId: input.companyId,
      createdById: input.user.id,
      documentId,
      documentType: "Tenant Agreement",
      recipientName: `${recipients.length} tenants`,
      recipientEmail: recipients[0].tenant_email,
      recipientRole: "Tenant",
      propertyAddress: premisesAddress,
      status: "Draft",
      token: legacyToken,
      adminToken: creatorToken,
      tenantToken: null,
      signingUrl: creatorSigningUrl,
      tenantSigningUrl: null,
      adminName: input.user.name || "Admin",
      adminEmail: input.user.email,
      tenantName: rosterLabel,
      tenantEmail: recipients[0].tenant_email,
      agreementData: JSON.stringify(agreementDataWithEmail),
      sentAt: null,
    },
  });

  await prisma.shmDocumentSigner.createMany({
    data: [
      {
        id: createToken(),
        documentId,
        name: input.user.name || "Admin",
        email: input.user.email,
        role: "Property Manager",
        signerType: "creator",
        token: creatorToken,
        signingUrl: creatorSigningUrl,
        status: "Awaiting Signature",
      },
      ...recipientSigners.map(({ recipient, role, token, signingUrl }) => ({
        id: createToken(),
        documentId,
        name: recipient.tenant_name,
        email: recipient.tenant_email,
        role,
        signerType: "recipient",
        token,
        signingUrl,
        status: "Not Sent",
      })),
    ],
  });

  if (input.request) {
    await logShmEvent(documentId, "Document Created", input.request);
    await logShmEvent(documentId, "multi_tenant_send", input.request);
  }

  agreementData = agreementDataWithEmail as Record<string, unknown>;

  return {
    documentId,
    creatorToken,
    creatorSigningUrl,
    propertyAddress: premisesAddress,
    agreementData,
    recipientSigners,
  };
}

/** Creator-sign once, then email each tenant their personal link to the shared agreement. */
export async function sendMultiTenantAgreementToTenants(input: {
  documentId: string;
  creatorToken: string;
  recipientSigners: Array<{
    recipient: TemplateRecipient;
    token: string;
    signingUrl: string;
  }>;
  propertyAddress?: string;
  agreementData: Record<string, unknown>;
  adminSignature?: string;
  adminName: string;
  adminEmail: string;
  request?: Request;
}) {
  const adminSignature = String(input.adminSignature || "").trim();

  const agreementData = normalizeAgreementLists({ ...input.agreementData });

  const doc = await prisma.shmDocument.findUnique({ where: { documentId: input.documentId } });
  if (!doc || doc.adminToken !== input.creatorToken) {
    throw new Error("Invalid document for send.");
  }

  await prisma.shmDocument.update({
    where: { documentId: input.documentId },
    data: {
      status: adminSignature ? "Awaiting Tenant" : "Awaiting Creator Signature",
      agreementData: JSON.stringify(agreementData),
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      tenantName: input.recipientSigners.map((row) => row.recipient.tenant_name).join(", "),
      ...(adminSignature
        ? { adminSignature, adminSignedAt: new Date() }
        : {}),
    },
  });

  if (adminSignature) {
    await prisma.shmDocumentSigner.updateMany({
      where: { documentId: input.documentId, signerType: "creator" },
      data: {
        name: input.adminName,
        email: input.adminEmail,
        role: "Creator",
        status: "Signed",
        signature: adminSignature,
        signedAt: new Date(),
      },
    });
  } else {
    await prisma.shmDocumentSigner.updateMany({
      where: { documentId: input.documentId, signerType: "creator" },
      data: {
        name: input.adminName,
        email: input.adminEmail,
        role: "Creator",
      },
    });
  }

  if (input.request) {
    await logShmEvent(input.documentId, adminSignature ? "admin_signed" : "sent_without_creator_signature", input.request);
  }

  const emailResults: Array<{
    tenant_name: string;
    tenant_email: string;
    signingUrl: string;
    emailOk: boolean;
    message?: string;
  }> = [];

  for (const row of input.recipientSigners) {
    const { recipient, signingUrl } = row;
    await prisma.shmDocumentSigner.updateMany({
      where: { documentId: input.documentId, email: recipient.tenant_email, signerType: "recipient" },
      data: {
        name: recipient.tenant_name,
        email: recipient.tenant_email,
        role: "Tenant",
        signingUrl,
        status: "Sent",
        sentAt: new Date(),
      },
    });

    const perTenantAgreement = {
      ...agreementData,
      recipientRole: "Tenant",
      recipientName: recipient.tenant_name,
      recipientEmail: recipient.tenant_email,
      tenant_name: recipient.tenant_name,
      tenant_email: recipient.tenant_email,
      premises_address: recipient.premises_address || input.propertyAddress || agreementData.premises_address,
    };

    const emailAttachments = await loadTenantAgreementEmailAttachmentsForSend({
      documentId: input.documentId,
      agreementData: perTenantAgreement,
      adminSignature,
      propertyAddress: String(perTenantAgreement.premises_address || input.propertyAddress || doc.propertyAddress || ""),
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      tenantName: recipient.tenant_name,
      tenantEmail: recipient.tenant_email,
    });

    const signingEmail = signingEmailContentForDocument("Tenant Agreement", doc.agreementData);
    const emailResult = await sendSigningEmail({
      to: recipient.tenant_email,
      name: recipient.tenant_name,
      documentType: "Tenant Agreement",
      signingUrl,
      propertyAddress: input.propertyAddress || doc.propertyAddress || undefined,
      documentId: input.documentId,
      creatorEmail: doc.adminEmail,
      creatorName: doc.adminName,
      attachments: emailAttachments.length ? emailAttachments : undefined,
      signingEmail,
    });

    if (input.request) {
      await logShmEvent(
        input.documentId,
        emailResult.ok ? "recipient_email_sent" : emailResult.skipped ? "recipient_email_skipped" : "recipient_email_error",
        input.request,
      );
    }

    if (emailResult.ok) {
      await markTenantSigningEmailDelivered(input.documentId);
    } else {
      await markTenantSigningEmailFailed(input.documentId);
    }

    emailResults.push({
      tenant_name: recipient.tenant_name,
      tenant_email: recipient.tenant_email,
      signingUrl,
      emailOk: Boolean(emailResult.ok),
      message: emailResult.ok ? "Sent" : emailResult.message || "Email may not have sent",
    });
  }

  if (input.request) {
    await logShmEvent(input.documentId, "sent_to_tenant", input.request);
  }

  return { emailResults };
}
