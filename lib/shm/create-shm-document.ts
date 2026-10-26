import { prisma } from "../prisma";
import {
  createToken,
  getSignUrl,
  isAdminFirstDocumentType,
  isCreatorPrepareBeforeRecipientEmail,
  isLandlordWeeklyReport,
  isOwnershipStatement,
  isOnePartySignedDocumentType,
  isPropertyManagementAgreement,
  isSignerSelfServiceForm,
  isTenantAgreement,
  isTenantApplication,
  logShmEvent,
  nextShmDocumentId,
} from "./documents";
import { sendSigningEmail } from "./mailer";
import {
  mergeSigningEmailPatchIntoJson,
  signingEmailContentForDocument,
} from "./signing-email-templates";
import type { BulkRecipient } from "./recipient-lines";
import { ensureApplicationForTenantDocument } from "../applications/link";
import { buildTenantApplicationAgreementData } from "./tenant-application-prefill";
import { buildLandlordRecord, parseLandlordInput } from "./tenant-application-landlord";
import { normalizePmaAgreementStorage } from "./property-management-agreement-fields";

export type CreateShmDocumentInput = {
  companyId: string;
  user: { id: string; name?: string | null; email: string };
  documentType: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientRole?: string;
  propertyAddress?: string;
  /** Optional rent ($) prefilled on Tenant Application Part D. */
  rentAmount?: string | null;
  /** Optional landlord who reviews and approves the applicant. */
  landlordName?: string | null;
  landlordEmail?: string | null;
  request?: Request;
  /** Attach Tenant Application to an existing rental application campaign. */
  rentalApplicationId?: string | null;
  applicantProfileId?: string | null;
  signingEmailSubject?: string | null;
  signingEmailBody?: string | null;
};

export type CreateShmDocumentResult = {
  documentId: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: string;
  propertyAddress: string;
  creatorSigningUrl?: string;
  signingUrl: string;
  emailStatus: "sent" | "skipped" | "error" | "not_applicable";
  emailMessage?: string;
  adminFirst: boolean;
};

function resolveRecipientFields(
  input: CreateShmDocumentInput,
  recipient?: BulkRecipient,
) {
  const documentType = input.documentType;
  const adminFirst = isAdminFirstDocumentType(documentType);
  const ownershipStatement = isOwnershipStatement(documentType);
  const landlordWeeklyReport = isLandlordWeeklyReport(documentType);
  const propertyManagementAgreement = isPropertyManagementAgreement(documentType);
  const signerSelfServiceForm = isSignerSelfServiceForm(documentType);

  const defaultRole = propertyManagementAgreement || signerSelfServiceForm
    ? "Owner"
    : ownershipStatement || landlordWeeklyReport
      ? landlordWeeklyReport ? "Landlord" : "Owner"
      : input.recipientRole || "Tenant";

  const name = String(recipient?.name || input.recipientName || "").trim();
  const email = String(recipient?.email || input.recipientEmail || "").trim().toLowerCase();
  const role = String(recipient?.role || defaultRole).trim();
  const rawProperty = String(
    recipient?.propertyAddress || input.propertyAddress || "",
  ).trim();
  const propertyAddress =
    signerSelfServiceForm && !propertyManagementAgreement
      ? ""
      : rawProperty;

  return {
    adminFirst,
    ownershipStatement,
    propertyManagementAgreement,
    signerSelfServiceForm,
    recipientName: ownershipStatement && !name ? "Owner" : name,
    recipientEmail: ownershipStatement && !email ? input.user.email : email,
    recipientRole: role,
    propertyAddress,
  };
}

export async function createShmDocument(
  input: CreateShmDocumentInput,
  recipient?: BulkRecipient,
): Promise<CreateShmDocumentResult> {
  const documentType = input.documentType.trim();
  if (!documentType) throw new Error("Document type is required.");

  const fields = resolveRecipientFields(input, recipient);
  const onePartySigned = isOnePartySignedDocumentType(documentType);

  const creatorPrepareFirst = isCreatorPrepareBeforeRecipientEmail(documentType);

  if (
    !fields.propertyManagementAgreement &&
    !fields.adminFirst &&
    !fields.signerSelfServiceForm &&
    !isLandlordWeeklyReport(documentType) &&
    !fields.propertyAddress
  ) {
    throw new Error("Property address is required for this document type.");
  }

  if (fields.propertyManagementAgreement && !fields.propertyAddress) {
    throw new Error("Property address is required for a Property Management Agreement.");
  }

  if (isLandlordWeeklyReport(documentType)) {
    if (!fields.recipientName) fields.recipientName = "Landlord";
    if (!fields.recipientRole) fields.recipientRole = "Landlord";
    if (!fields.recipientEmail || !fields.recipientEmail.includes("@")) {
      fields.recipientEmail = input.user.email.trim().toLowerCase();
    }
  }

  if (
    !fields.ownershipStatement
    && !isLandlordWeeklyReport(documentType)
    && (!fields.recipientName || !fields.recipientEmail || !fields.recipientRole)
  ) {
    throw new Error("Recipient name, email, and role are required.");
  }

  if (fields.ownershipStatement && !fields.recipientEmail) {
    throw new Error("Owner email is required.");
  }

  const documentId = await nextShmDocumentId();
  const recipientToken = createToken();
  const creatorToken = onePartySigned ? null : createToken();
  const signingUrl = getSignUrl(documentId, recipientToken, "recipient");
  const creatorSigningUrl = creatorToken ? getSignUrl(documentId, creatorToken, "creator") : null;

  const landlordInput = isTenantApplication(documentType)
    ? parseLandlordInput(input.landlordName, input.landlordEmail)
    : null;
  const landlord = landlordInput
    ? buildLandlordRecord(landlordInput.name, landlordInput.email)
    : null;

  let agreementData =
    isTenantApplication(documentType)
      ? buildTenantApplicationAgreementData({
          propertyAddress: fields.propertyAddress,
          rentAmount: input.rentAmount,
          landlord,
        })
      : null;

  if (input.signingEmailSubject || input.signingEmailBody) {
    agreementData = mergeSigningEmailPatchIntoJson(
      agreementData,
      documentType,
      input.signingEmailSubject,
      input.signingEmailBody,
    );
  } else if (!isTenantApplication(documentType)) {
    agreementData = mergeSigningEmailPatchIntoJson(agreementData, documentType);
  }

  if (fields.propertyManagementAgreement) {
    const parsed = agreementData ? (JSON.parse(agreementData) as Record<string, unknown>) : {};
    agreementData = JSON.stringify(
      normalizePmaAgreementStorage({
        ...parsed,
        property: fields.propertyAddress,
        pma_property: fields.propertyAddress,
        owner: fields.recipientName,
        pma_owner: fields.recipientName,
        owner_sign_name: fields.recipientName,
        pma_owner_sign_name: fields.recipientName,
        deposit_to: fields.recipientName,
        pma_deposit_to: fields.recipientName,
        email: fields.recipientEmail,
        pma_email: fields.recipientEmail,
      }),
    );
  }

  await prisma.shmDocument.create({
    data: {
      companyId: input.companyId,
      createdById: input.user.id,
      documentId,
      documentType,
      recipientName: fields.recipientName,
      recipientEmail: fields.recipientEmail,
      recipientRole: fields.recipientRole,
      propertyAddress: fields.propertyAddress,
      agreementData: agreementData ?? undefined,
      status: creatorPrepareFirst ? "Draft" : "Sent",
      token: recipientToken,
      adminToken: creatorToken,
      tenantToken: recipientToken,
      signingUrl,
      tenantSigningUrl: signingUrl,
      adminName: input.user.name || "Admin",
      adminEmail: input.user.email,
      tenantName: isTenantAgreement(documentType) || fields.recipientRole === "Tenant" ? fields.recipientName : undefined,
      tenantEmail: isTenantAgreement(documentType) || fields.recipientRole === "Tenant" ? fields.recipientEmail : undefined,
      sentAt: creatorPrepareFirst ? null : new Date(),
    },
  });

  const signerRows: Array<{
    id: string;
    documentId: string;
    name: string;
    email: string;
    role: string;
    signerType: string;
    token: string;
    signingUrl: string | null;
    status: string;
    sentAt?: Date | null;
  }> = [
    {
      id: createToken(),
      documentId,
      name: fields.recipientName,
      email: fields.recipientEmail,
      role: fields.recipientRole,
      signerType: "recipient",
      token: recipientToken,
      signingUrl,
      status: creatorPrepareFirst ? "Waiting" : "Sent",
      sentAt: creatorPrepareFirst ? null : new Date(),
    },
  ];

  if (!onePartySigned && creatorToken && creatorSigningUrl) {
    signerRows.unshift({
      id: createToken(),
      documentId,
      name: input.user.name || "Creator",
      email: input.user.email,
      role: "Creator",
      signerType: "creator",
      token: creatorToken,
      signingUrl: creatorSigningUrl,
      status: "Not Signed",
      sentAt: null,
    });
  }

  await prisma.shmDocumentSigner.createMany({ data: signerRows });

  if (isTenantApplication(documentType)) {
    try {
      await ensureApplicationForTenantDocument({
        companyId: input.companyId,
        createdById: input.user.id,
        documentId,
        propertyAddress: fields.propertyAddress,
        recipientName: fields.recipientName,
        recipientEmail: fields.recipientEmail,
        rentalApplicationId: input.rentalApplicationId,
        applicantProfileId: input.applicantProfileId,
      });
    } catch {
      // Non-blocking: signing flow must not fail if application sidecar is unavailable
    }
  }

  const logRequest = input.request || new Request("http://localhost/internal");
  await logShmEvent(
    documentId,
    creatorPrepareFirst ? "created_creator_first" : "sent",
    logRequest,
  );

  if (creatorPrepareFirst) {
    return {
      documentId,
      recipientName: fields.recipientName,
      recipientEmail: fields.recipientEmail,
      recipientRole: fields.recipientRole,
      propertyAddress: fields.propertyAddress,
      creatorSigningUrl: creatorSigningUrl || undefined,
      signingUrl,
      emailStatus: "not_applicable",
      adminFirst: true,
    };
  }

  const signingEmailContent = signingEmailContentForDocument(documentType, agreementData);
  const signingEmailPromise = sendSigningEmail({
    to: fields.recipientEmail,
    name: fields.recipientName,
    documentType,
    signingUrl,
    propertyAddress: fields.propertyAddress,
    documentId,
    creatorEmail: input.user.email,
    creatorName: input.user.name,
    signingEmail: signingEmailContent,
  });

  // Landlord notice runs in parallel with the signer email for the same document send.
  const landlordNoticePromise =
    landlord && isTenantApplication(documentType)
      ? (async () => {
          try {
            const { sendLandlordApplicationSentNotice } = await import("./mailer");
            return await sendLandlordApplicationSentNotice({
              to: landlord.email,
              landlordName: landlord.name,
              applicantName: fields.recipientName,
              applicantEmail: fields.recipientEmail,
              propertyAddress: fields.propertyAddress,
              documentId,
              rentAmount: input.rentAmount,
            });
          } catch {
            return null;
          }
        })()
      : Promise.resolve(null);

  const [emailResult, landlordNotice] = await Promise.all([signingEmailPromise, landlordNoticePromise]);

  if (landlordNotice) {
    await logShmEvent(
      documentId,
      landlordNotice.ok
        ? "landlord_application_sent_notice_sent"
        : landlordNotice.skipped
          ? "landlord_application_sent_notice_skipped"
          : "landlord_application_sent_notice_error",
      logRequest,
    );
  }

  if (emailResult.ok) {
    await logShmEvent(documentId, "recipient_email_sent", logRequest);

    return {
      documentId,
      recipientName: fields.recipientName,
      recipientEmail: fields.recipientEmail,
      recipientRole: fields.recipientRole,
      propertyAddress: fields.propertyAddress,
      signingUrl,
      emailStatus: "sent",
      adminFirst: false,
    };
  }

  if (emailResult.skipped) {
    await logShmEvent(documentId, "recipient_email_skipped", logRequest);
    return {
      documentId,
      recipientName: fields.recipientName,
      recipientEmail: fields.recipientEmail,
      recipientRole: fields.recipientRole,
      propertyAddress: fields.propertyAddress,
      signingUrl,
      emailStatus: "skipped",
      emailMessage: emailResult.message,
      adminFirst: false,
    };
  }

  await logShmEvent(documentId, "recipient_email_error", logRequest);
  return {
    documentId,
    recipientName: fields.recipientName,
    recipientEmail: fields.recipientEmail,
    recipientRole: fields.recipientRole,
    propertyAddress: fields.propertyAddress,
    signingUrl,
    emailStatus: "error",
    emailMessage: emailResult.message,
    adminFirst: false,
  };
}
