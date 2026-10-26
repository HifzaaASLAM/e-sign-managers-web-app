"use server";

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { createShmDocument } from "../../../../lib/shm/create-shm-document";
import {
  createMultiTenantAgreementFromTemplate,
  createTenantAgreementFromTemplate,
} from "../../../../lib/shm/create-from-template";
import { getSignUrl, isTenantAgreement } from "../../../../lib/shm/documents";
import { parseTenantRecipientsJson } from "../../../../lib/shm/parse-tenant-recipients-json";
import { ensureTenantAgreementTemplateTable } from "../../../../lib/shm/ensure-ta-template-table";

export type CreateDocumentState = {
  ok: boolean;
  message: string;
  emailStatus?: "sent" | "skipped" | "error" | "not_applicable";
  documentId?: string;
  recipientEmail?: string;
};

export async function createShmDocumentAction(
  _prevState: CreateDocumentState | null,
  formData: FormData,
): Promise<CreateDocumentState> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) redirect("/register");

  const documentType = String(formData.get("documentType") || "").trim();
  const propertyAddress = String(formData.get("propertyAddress") || "").trim();
  const recipientNameInput = String(formData.get("recipientName") || "").trim();
  const recipientEmailInput = String(formData.get("recipientEmail") || "").trim().toLowerCase();
  const recipientRoleInput = String(formData.get("recipientRole") || "").trim();
  const templateId = String(formData.get("templateId") || "").trim();
  const signingEmailSubject = String(formData.get("signingEmailSubject") || "").trim();
  const signingEmailBody = String(formData.get("signingEmailBody") || "").trim();

  if (!documentType) {
    return { ok: false, message: "Please select a document type." };
  }

  try {
    if (isTenantAgreement(documentType)) {
      await ensureTenantAgreementTemplateTable();

      const template = templateId
        ? await prisma.shmTenantAgreementTemplate.findFirst({
            where: { id: templateId, companyId: company.id, isActive: true },
          })
        : await prisma.shmTenantAgreementTemplate.findFirst({
            where: { companyId: company.id, isActive: true },
            orderBy: { updatedAt: "desc" },
          });

      const tenantRecipientsFromForm = parseTenantRecipientsJson(
        String(formData.get("tenantRecipientsJson") || ""),
      );
      const tenantRecipients =
        tenantRecipientsFromForm.length >= 2
          ? tenantRecipientsFromForm.map((row) => ({
              ...row,
              premises_address: row.premises_address || propertyAddress || undefined,
            }))
          : [];

      if (tenantRecipients.length >= 2) {
        const created = await createMultiTenantAgreementFromTemplate({
          companyId: company.id,
          user: { id: user.id, name: user.name, email: user.email },
          template: template ? { agreementData: template.agreementData } : null,
          recipients: tenantRecipients,
          signingEmailSubject,
          signingEmailBody,
        });

        redirect(
          created.creatorSigningUrl ||
            getSignUrl(created.documentId, created.creatorToken, "creator"),
        );
      }

      if (!template && tenantRecipientsFromForm.length < 2) {
        if (!recipientNameInput || !recipientEmailInput) {
          return { ok: false, message: "Tenant name and email are required for a Tenant Agreement." };
        }
      }

      if (template) {
        if (!recipientNameInput || !recipientEmailInput) {
          return { ok: false, message: "Tenant name and email are required for a Tenant Agreement." };
        }

        const created = await createTenantAgreementFromTemplate({
          companyId: company.id,
          user: { id: user.id, name: user.name, email: user.email },
          template,
          recipient: {
            tenant_name: recipientNameInput,
            tenant_email: recipientEmailInput,
            premises_address: propertyAddress || undefined,
          },
          signingEmailSubject,
          signingEmailBody,
        });

        redirect(created.creatorSigningUrl);
      }
    }

    const result = await createShmDocument({
      companyId: company.id,
      user: { id: user.id, name: user.name, email: user.email },
      documentType,
      propertyAddress,
      recipientName: recipientNameInput,
      recipientEmail: recipientEmailInput,
      recipientRole: recipientRoleInput,
      signingEmailSubject,
      signingEmailBody,
    });

    if (result.adminFirst && result.creatorSigningUrl) {
      redirect(result.creatorSigningUrl);
    }

    if (result.emailStatus === "sent") {
      redirect(
        `/dashboard?email=sent&to=${encodeURIComponent(result.recipientEmail)}&doc=${encodeURIComponent(result.documentId)}`,
      );
    }

    if (result.emailStatus === "skipped") {
      redirect(
        `/dashboard?email=skipped&reason=${encodeURIComponent(result.emailMessage || "Email not configured.")}&doc=${encodeURIComponent(result.documentId)}`,
      );
    }

    if (result.emailStatus === "error") {
      redirect(
        `/dashboard?email=error&reason=${encodeURIComponent(result.emailMessage || "Email failed.")}&doc=${encodeURIComponent(result.documentId)}`,
      );
    }

    return {
      ok: true,
      emailStatus: result.emailStatus,
      documentId: result.documentId,
      recipientEmail: result.recipientEmail,
      message: `Document ${result.documentId} created.`,
    };
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Could not create document.";
    return { ok: false, message };
  }
}
