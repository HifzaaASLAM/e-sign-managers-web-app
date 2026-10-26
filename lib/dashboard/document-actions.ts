import { getServerSession } from "next-auth";
import type { User } from "@prisma/client";
import { authOptions } from "../auth";
import { prisma } from "../prisma";
import { getWorkspaceByEmail } from "../workspace";
import {
  mergePmaFieldValues,
  normalizePmaAgreementStorage,
  parsePmaAgreementData,
} from "../shm/property-management-agreement-fields";

type DocWithSigners = NonNullable<
  Awaited<ReturnType<typeof prisma.shmDocument.findFirst<{ include: { signers: true } }>>>
>;

export async function requireDashboardDocument(documentId: string): Promise<
  | { error: { status: 401 | 403 | 400 | 404; message: string } }
  | { error?: undefined; session: Awaited<ReturnType<typeof getServerSession>>; user: User; company: { id: string }; doc: DocWithSigners }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const { user, company } = await getWorkspaceByEmail(session.user.email);
  if (!user || !company) {
    return { error: { status: 403, message: "Workspace not found" } };
  }

  const docId = decodeURIComponent(documentId || "").trim();
  if (!docId) {
    return { error: { status: 400, message: "Document ID is required" } };
  }

  const doc = await prisma.shmDocument.findFirst({
    where: { companyId: company.id, documentId: docId },
    include: { signers: true },
  });

  if (!doc) {
    return { error: { status: 404, message: "Document not found" } };
  }

  return { session, user, company, doc };
}

export function stripAgreementSignatures(agreementDataRaw: string | null | undefined) {
  if (!agreementDataRaw) return null;
  try {
    const data = JSON.parse(agreementDataRaw) as Record<string, unknown>;
    let merged: Record<string, unknown> = { ...data };

    if (data.field_values && typeof data.field_values === "object" && !Array.isArray(data.field_values)) {
      merged = { ...merged, ...(data.field_values as Record<string, unknown>) };
    }

    const lastSub = data.last_submission;
    if (lastSub && typeof lastSub === "object" && !Array.isArray(lastSub)) {
      const submission = lastSub as Record<string, unknown>;
      merged = {
        ...merged,
        ...parsePmaAgreementData(submission.agreement_data),
        ...parsePmaAgreementData(submission.field_values),
      };
    }

    merged = mergePmaFieldValues({}, merged);
    merged = normalizePmaAgreementStorage(merged);
    delete merged.last_submission;
    delete merged.admin_signature;
    delete merged.tenant_signature;
    delete merged.provider_signature;
    delete merged.signature;
    delete merged.pma_sig;
    delete merged.pma_agent_sig;
    return JSON.stringify(merged);
  } catch {
    return agreementDataRaw;
  }
}

export function isTerminalStatus(status: string) {
  const value = String(status || "").toLowerCase();
  return value === "withdrawn" || value === "signed" || value === "void" || value === "cancelled";
}

export function isWithdrawn(status: string) {
  return String(status || "").toLowerCase() === "withdrawn";
}
