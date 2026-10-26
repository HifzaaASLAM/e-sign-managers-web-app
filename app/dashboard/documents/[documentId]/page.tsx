import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { getDashboardDocumentFileUrl } from "../../../../lib/dashboard/document-file";
import {
  isAdminOnlySignedDocumentType,
  isOnePartySignedDocumentType,
  isPropertyManagementAgreement,
  isTenantAgreement,
  isTenantApplication,
  getSignUrl,
} from "../../../../lib/shm/documents";
import { resolveOwnershipStatementDocumentStatus } from "../../../../lib/shm/ownership-statement-status";
import { DocumentSignerActions, DocumentToolbar } from "../../../../components/dashboard/DocumentActions";
import { ApplicationCampaignPanel } from "../../../../components/dashboard/ApplicationCampaignPanel";
import { DashboardHeader } from "../../../../components/dashboard/DashboardHeader";
import { getApplyUrl } from "../../../../lib/applications/service";
import {
  describeRecipientEmailDelivery,
  loadLatestSigningEmailLog,
} from "../../../../lib/dashboard/recipient-email-delivery";
import { triggerDuePmaAutoCreatorSignsInBackground } from "../../../../lib/shm/pma-auto-creator-sign-tick";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { documentId: string };
};

function formatDate(value: Date | null | undefined, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(value);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function displayStatus(status: string, isOwnership = false) {
  if (status === "Signed") return "Signed";
  if (status === "Withdrawn") return "Withdrawn";
  if (status === "Processing") return "Processing final file";
  if (status === "Viewed") return isOwnership ? "Viewed" : "Waiting for signatures";
  if (status === "Sent") return isOwnership ? "Sent" : "Waiting for signatures";
  if (status === "Awaiting Creator Signature") return "Awaiting creator signature";
  if (status === "Awaiting Recipient Signature" || status === "Awaiting Tenant") return "Awaiting recipient signature";
  if (status === "Make Error") return "Final file error";
  if (status === "Draft") return "Draft";
  return status;
}

function statusColor(status: string) {
  if (status === "Signed") return "bg-emerald-500";
  if (status === "Withdrawn") return "bg-slate-400";
  if (status === "Viewed") return "bg-amber-500";
  if (status === "Processing") return "bg-purple-500";
  if (status === "Make Error") return "bg-red-500";
  if (status.includes("Awaiting")) return "bg-orange-500";
  return "bg-blue-500";
}

async function loadDocumentDetail(companyId: string, documentId: string) {
  return prisma.shmDocument.findFirst({
    where: { companyId, documentId },
    include: {
      signers: { orderBy: { signerType: "asc" } },
      events: { orderBy: { eventTime: "desc" }, take: 120 },
    },
  });
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  let companyId: string | null = null;
  try {
    const { company } = await getWorkspaceByEmail(session.user.email);
    companyId = company?.id ?? null;
  } catch (error) {
    console.error("[document-detail] workspace lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <section className="mx-auto max-w-5xl px-5 py-10">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load workspace. Please refresh, or check the database connection.
          </div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }
  if (!companyId) redirect("/register");

  let doc = null as Awaited<ReturnType<typeof loadDocumentDetail>> | null;
  try {
    doc = await loadDocumentDetail(companyId, params.documentId);
  } catch (error) {
    console.error("[document-detail] document lookup failed", error);
    return (
      <main className="min-h-screen bg-white text-slate-950">
        <section className="mx-auto max-w-5xl px-5 py-10">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load this document. Tables may be missing or the database is unavailable.
          </div>
          <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }

  if (!doc) notFound();

  if (isTenantApplication(doc.documentType)) {
    try {
      const { ensureTenantApplicationAutoApproveForDocument } = await import(
        "../../../../lib/shm/tenant-application-auto-approve"
      );
      const ensured = await ensureTenantApplicationAutoApproveForDocument(doc.documentId);
      if (ensured) {
        const refreshed = await loadDocumentDetail(companyId, params.documentId);
        if (refreshed) doc = refreshed;
      }
    } catch (error) {
      console.error("[document-detail] tenant application ensure failed", error);
    }
  }

  if (
    isPropertyManagementAgreement(doc.documentType)
    && !doc.adminSignedAt
    && (doc.tenantSignedAt || doc.signedAt)
  ) {
    triggerDuePmaAutoCreatorSignsInBackground([doc.documentId]);
  }

  if (!doc) notFound();

  let application: {
    id: string;
    decisionStatus: string;
    readinessScore: number;
    inviteToken: string | null;
  } | null = null;

  if (isTenantApplication(doc.documentType)) {
    try {
      const applicationLink = await prisma.rentalApplicationDocument.findFirst({
        where: { documentId: doc.documentId },
        include: {
          application: {
            select: {
              id: true,
              companyId: true,
              decisionStatus: true,
              readinessScore: true,
              inviteToken: true,
            },
          },
        },
      });
      if (applicationLink?.application?.companyId === companyId) {
        application = {
          id: applicationLink.application.id,
          decisionStatus: applicationLink.application.decisionStatus,
          readinessScore: applicationLink.application.readinessScore,
          inviteToken: applicationLink.application.inviteToken,
        };
      }
    } catch (error) {
      console.error("[document-detail] rental application lookup failed", error);
    }
  }

  const recipient = doc.signers.find((signer) => signer.signerType === "recipient");
  const additionalRecipients = doc.signers.filter(
    (signer) => signer.signerType === "recipient" && signer.id !== recipient?.id && signer.status !== "Removed",
  );
  const creator = doc.signers.find((signer) => signer.signerType === "creator");
  const isOneParty = isOnePartySignedDocumentType(doc.documentType);
  const isAdminOnlySigned = isAdminOnlySignedDocumentType(doc.documentType);
  const isTenantAgreementDoc = isTenantAgreement(doc.documentType);
  const recipientName = recipient?.name || doc.recipientName;
  const recipientEmail = recipient?.email || doc.recipientEmail;
  const recipientRole = recipient?.role || doc.recipientRole;
  const recipientStatus = recipient?.status || (doc.tenantSignedAt || doc.signedAt ? "Signed" : doc.viewedAt ? "Viewed" : doc.sentAt ? "Sent" : "Not Sent");
  const creatorName = creator?.name || doc.adminName || "Creator";
  const creatorEmail = creator?.email || doc.adminEmail || "—";
  const creatorStatus = isAdminOnlySigned
    ? (creator?.status === "Signed" ? "Sent" : creator?.status || (doc.adminSignedAt ? "Sent" : "Not Sent"))
    : isOneParty
      ? "No signature required"
      : creator?.status || (doc.adminSignedAt ? "Signed" : "Not Signed");
  const resolvedStatus = (() => {
    // Repair one-party docs stuck on creator-awaiting after a bad Amend click.
    if (isOneParty && recipientStatus === "Signed") {
      if (doc.status === "Make Error") return "Make Error";
      if (doc.status === "Signed" || doc.signedDriveUrl) return "Signed";
      if (doc.status === "Processing") return "Processing";
      return "Signed";
    }
    if (isAdminOnlySigned) {
      return resolveOwnershipStatementDocumentStatus(doc.status, doc.signedDriveUrl, recipientStatus, Boolean(doc.adminSignedAt));
    }
    return doc.status;
  })();
  const signerUrl = recipient?.signingUrl || doc.signingUrl || null;
  const creatorSignUrl =
    creator?.signingUrl
    || (doc.adminToken ? getSignUrl(doc.documentId, doc.adminToken, "creator") : null);

  let storedPreviewUrl: string | null = null;
  try {
    storedPreviewUrl = getDashboardDocumentFileUrl(doc.documentId, doc.agreementData, doc.documentType);
  } catch (error) {
    console.error("[document-detail] preview url failed", error);
  }
  // Always use inline API preview for PDF — do not send Preview to Drive folder URLs.
  const filePreviewUrl = storedPreviewUrl;
  const previewUrl = storedPreviewUrl
    || doc.signedDriveUrl
    || (isAdminOnlySigned && doc.adminSignedAt && storedPreviewUrl)
    || (!isAdminOnlySigned && (signerUrl || creatorSignUrl))
    || null;
  const title = [recipientName, doc.propertyAddress, doc.documentType].filter(Boolean).join(" - ");
  const expiry = addDays(doc.createdAt, 30);
  const recipientSigned = recipientStatus === "Signed";
  const creatorSigned = isOneParty || isTenantAgreementDoc
    ? true
    : creatorStatus === "Signed" || Boolean(doc.adminSignedAt);
  const recipientRemoved = recipientStatus === "Removed";
  const canResend = Boolean(recipientEmail?.includes("@") && !recipientSigned && !recipientRemoved && resolvedStatus !== "Withdrawn");

  // Persist repaired status so dashboard list stays in sync.
  if (
    isOneParty
    && recipientSigned
    && doc.status !== resolvedStatus
    && ["Awaiting Creator Signature", "Awaiting Recipient Signature", "Awaiting Tenant"].includes(doc.status)
  ) {
    try {
      await prisma.shmDocument.update({
        where: { documentId: doc.documentId },
        data: { status: resolvedStatus },
      });
    } catch (error) {
      console.warn("[document-detail] status repair skipped", error);
    }
  }

  const eventLabel: Record<string, string> = {
    created: "Contract created",
    sent: "Contract is sent to signer by email",
    viewed: "Contract is viewed by signer",
    opened: "Contract is opened by signer",
    signed: "Contract is signed",
    applicant_signed: "Tenant application is signed by applicant",
    make_webhook_sent: "Final document sent to Make.com",
    drive_callback_received: "Google Drive final file received",
    admin_notification_sent: "Admin notification email sent",
    final_file_ready_notification_sent: "Final file ready notification sent",
    email_sent: "Signing email sent",
    withdrawn: "Contract withdrawn",
    resent_to_recipient: "Contract re-sent to recipient",
    recipient_updated: "Recipient details updated",
    recipient_removed: "Recipient removed",
    signer_added: "Signer added",
    signer_added_email_sent: "Signer added and invitation emailed",
    admin_signed: "Creator signed the document",
    sent_to_tenant: "Signing request sent to tenant",
    recipient_email_sent: "Signing email delivered (Resend accepted)",
    recipient_email_skipped: "Signing email skipped (configuration)",
    recipient_email_error: "Signing email failed",
    resent_to_recipient: "Signing email re-sent to recipient",
    resend_error: "Re-send failed",
    resend_skipped: "Re-send skipped (configuration)",
  };

  const latestSigningEmail = await loadLatestSigningEmailLog(prisma, doc.documentId, recipientEmail);
  const emailDelivery = describeRecipientEmailDelivery({
    recipientStatus,
    creatorSigned,
    recipientSigned,
    sentAt: doc.sentAt,
    lastSigningEmailStatus: latestSigningEmail?.status,
    lastSigningEmailError: latestSigningEmail?.error,
  });

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <DashboardHeader active="/dashboard" />
      <section className="mx-auto max-w-5xl px-5 py-10">
        <DocumentToolbar
          documentId={doc.documentId}
          status={resolvedStatus}
          previewUrl={previewUrl}
          filePreviewUrl={filePreviewUrl}
          creatorSigned={creatorSigned}
          recipientSigned={recipientSigned}
          recipientRemoved={recipientRemoved}
          recipientEmail={recipientEmail}
          recipientName={recipientName}
          recipientRole={recipientRole}
          onePartyDocument={isOneParty}
          reportOnly={isAdminOnlySigned}
        />

        <div className="mt-8">
          <h1 className="max-w-5xl text-4xl font-black leading-tight tracking-tight text-slate-950">
            {title}
          </h1>
          <div className="mt-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-600">
            <span className={`h-2 w-2 rounded-full ${statusColor(resolvedStatus)}`} />
            {displayStatus(resolvedStatus, isAdminOnlySigned)}
          </div>
        </div>

        <div className="mt-8 flex items-center gap-14 text-sm">
          <div className="font-bold text-slate-950">Expires:</div>
          <div className="font-semibold text-slate-800">{formatDate(expiry)}</div>
        </div>

        {application ? (
          <ApplicationCampaignPanel
            applicationId={application.id}
            decisionStatus={application.decisionStatus}
            readinessScore={application.readinessScore}
            applyUrl={application.inviteToken ? getApplyUrl(application.inviteToken) : null}
            documentId={doc.documentId}
          />
        ) : null}

        <section className="mt-20 border-t border-slate-200 pt-8">
          <DocumentSignerActions
            documentId={doc.documentId}
            status={resolvedStatus}
            recipientSigned={recipientSigned}
            recipientEmail={recipientEmail}
            recipientName={recipientName}
            recipientRole={recipientRole}
            recipientStatus={recipientStatus}
            canResend={canResend}
            signerUrl={!isAdminOnlySigned && recipientStatus !== "Removed" ? signerUrl : null}
            emailVerifiedLabel={recipient?.viewedAt || doc.viewedAt ? formatDate(recipient?.viewedAt || doc.viewedAt, true) : "Not yet"}
            nextReminderLabel={formatDate(addDays(doc.sentAt || doc.createdAt, 2), true)}
            emailDeliveryLabel={isAdminOnlySigned ? (doc.sentAt ? "Report emailed to landlord" : undefined) : emailDelivery.label}
            emailDeliveryDetail={isAdminOnlySigned ? undefined : emailDelivery.detail}
            emailDeliveryTone={emailDelivery.tone}
            reportOnly={isAdminOnlySigned}
          />
        </section>

        {additionalRecipients.map((extra) => (
          <section key={extra.id} className="mt-12 border-t border-slate-200 pt-8">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-950">{extra.name}</h2>
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 text-[10px] ${
                    extra.status === "Signed"
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 bg-white text-slate-400"
                  }`}
                >
                  {extra.status === "Signed" ? "✓" : ""}
                </span>
              </div>
            </div>
            <div className="mt-8 grid gap-10 md:grid-cols-2">
              <div className="space-y-3 text-sm leading-6">
                <p><span className="font-bold">Name:</span> {extra.name}</p>
                <p><span className="font-bold">Email:</span> {extra.email}</p>
                <p><span className="font-bold">Title/company:</span> {extra.role}</p>
                <p><span className="font-bold">Status:</span> {extra.status}</p>
              </div>
              <div className="space-y-3 text-sm leading-6">
                <p><span className="font-bold">Email address is verified:</span> {extra.viewedAt ? formatDate(extra.viewedAt, true) : "Not yet"}</p>
                {extra.signingUrl && extra.status !== "Signed" && extra.status !== "Removed" ? (
                  <a href={extra.signingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-slate-900 hover:text-blue-700">
                    Show direct link
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        ))}

        {(() => {
          let agreement: Record<string, unknown> = {};
          try {
            agreement = doc.agreementData ? JSON.parse(doc.agreementData) : {};
          } catch {
            agreement = {};
          }
          const names = Array.isArray(agreement.attachment_names)
            ? agreement.attachment_names.map((n) => String(n))
            : Array.isArray(agreement.attachment_manifest)
              ? (agreement.attachment_manifest as Array<Record<string, unknown>>).map((row) => String(row.fileName || ""))
              : Array.isArray(agreement.uploaded_attachments)
                ? (agreement.uploaded_attachments as Array<Record<string, unknown>>).map((row) => String(row.fileName || ""))
                : [];
          const files = names.filter(Boolean);
          if (!files.length && !doc.signedDriveUrl) return null;
          return (
            <section className="mt-20 border-t border-slate-200 pt-8">
              <h2 className="text-xl font-black text-slate-950">Supporting files</h2>
              {doc.signedDriveUrl ? (
                <p className="mt-3 text-sm">
                  <a href={doc.signedDriveUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                    Open Google Drive folder
                  </a>
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Drive folder link appears after upload completes.</p>
              )}
              {files.length ? (
                <ul className="mt-5 space-y-2 text-sm text-slate-800">
                  {files.map((name) => (
                    <li key={name} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      {name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })()}

        {!isTenantAgreementDoc && !isAdminOnlySigned ? (
          <section className="mt-20">
            <h2 className="text-xl font-black text-slate-950">Creator</h2>
            <div className="mt-5 grid gap-10 border-t border-slate-200 pt-6 md:grid-cols-2">
              <div className="space-y-3 text-sm leading-6">
                <p><span className="font-bold">Name:</span> {creatorName}</p>
                <p><span className="font-bold">Email:</span> {creatorEmail}</p>
                <p><span className="font-bold">Status:</span> {creatorStatus}</p>
              </div>
              {!isOneParty && !isAdminOnlySigned && creatorSignUrl && creatorStatus !== "Signed" && resolvedStatus !== "Withdrawn" && (
                <div>
                  <a href={creatorSignUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Sign as creator
                  </a>
                </div>
              )}
            </div>
          </section>
        ) : null}

        <section className="mt-20">
          <h2 className="text-xl font-black text-slate-950">Audit trail</h2>
          <div className="mt-8 space-y-6">
            {doc.events.length > 0 ? (
              [...doc.events].reverse().map((event) => (
                <div key={event.id} className="grid gap-4 text-sm md:grid-cols-[180px_1fr_180px]">
                  <time className="text-slate-700">{formatDate(event.eventTime, true)}</time>
                  <p className="text-slate-950">{eventLabel[event.eventType] || event.eventType.replace(/_/g, " ")}</p>
                  <p className="text-slate-700">{recipientName}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No audit events recorded yet.</p>
            )}
          </div>
        </section>

        <div className="mt-10">
          <Link href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
