import Link from "next/link";
import { prisma } from "../../lib/prisma";
import {
  validateShmToken,
  signerRoleForToken,
  isPropertyManagementAgreement,
} from "../../lib/shm/documents";
import { isRevokedToken } from "../../lib/shm/signing-access";
import { DashboardHeader } from "../../components/dashboard/DashboardHeader";

export const dynamic = "force-dynamic";

function signerAlreadySigned(
  doc: NonNullable<Awaited<ReturnType<typeof validateShmToken>>>,
  signerRole: string,
  activeSigner: { status: string } | null,
) {
  if (activeSigner?.status === "Signed") return true;
  if (activeSigner && activeSigner.status !== "Signed" && activeSigner.status !== "Removed") return false;
  const recipientSigners = doc.signers.filter((s) => s.signerType === "recipient" && s.status !== "Removed");
  let multiTenantSharedDoc = recipientSigners.length > 1;
  try {
    const data = doc.agreementData ? JSON.parse(doc.agreementData) : {};
    if (data.multi_tenant_send === true) multiTenantSharedDoc = true;
  } catch {
    // ignore
  }
  if (signerRole === "recipient" && multiTenantSharedDoc) {
    return activeSigner?.status === "Signed";
  }
  const stored = doc.signers.find((s) => s.signerType === signerRole);
  if (stored?.status === "Signed") return true;
  if (signerRole === "creator" && doc.adminSignedAt) return true;
  if (signerRole === "recipient" && (doc.tenantSignedAt || doc.signedAt)) return true;
  return false;
}

export default async function SignDocumentPage({
  searchParams,
}: {
  searchParams: { doc_id?: string; token?: string; role?: string };
}) {
  const docId = searchParams.doc_id || "";
  const token = searchParams.token || "";
  const doc = await validateShmToken(docId, token);

  if (!doc) {
    let usedLink = isRevokedToken(token);
    if (!usedLink && docId) {
      const existing = await prisma.shmDocument.findUnique({
        where: { documentId: docId },
        include: { signers: true },
      });
      if (existing) {
        const signerForToken = existing.signers.find((s) => s.token === token);
        if (signerForToken) {
          usedLink = signerForToken.status === "Signed" || isRevokedToken(token);
        } else {
          usedLink =
            existing.signers.some((s) => s.status === "Signed") ||
            Boolean(existing.adminSignedAt || existing.tenantSignedAt);
        }
      }
    }

    return (
      <main className="min-h-screen bg-slate-50 px-5 py-16">
        <section className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
          <h1 className="text-3xl font-black text-slate-950">
            {usedLink ? "Signing link already used" : "Invalid signing link"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {usedLink
              ? "This signing link has already been used or is no longer valid. Each person can only sign once, and forwarded links will not work."
              : "This document link is invalid, expired, or not connected to a valid document."}
          </p>
          <Link href="/" className="mt-6 inline-flex rounded-xl bg-[#1677ff] px-5 py-3 text-sm font-black text-white">
            Back to home
          </Link>
        </section>
      </main>
    );
  }

  const activeSigner = doc.signers.find((signer) => signer.token === token) || null;
  const signerRole = searchParams.role || activeSigner?.signerType || signerRoleForToken(doc, token);

  if (signerAlreadySigned(doc, signerRole, activeSigner)) {
    return (
      <main className="min-h-screen bg-[#eef3f7] px-5 py-16">
        <section className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-slate-950">You have already signed</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            This document was already signed with your link. Signing links are single-use and cannot be shared or
            forwarded.
          </p>
          <Link
            href={signerRole === "creator" ? "/dashboard" : "/signing-complete"}
            className="mt-6 inline-flex rounded-xl bg-[#1677ff] px-5 py-3 text-sm font-black text-white"
          >
            Continue
          </Link>
        </section>
      </main>
    );
  }

  const showCreatorWebsiteHeader =
    signerRole === "creator" && isPropertyManagementAgreement(doc.documentType);

  const frameQuery = new URLSearchParams({ doc_id: docId, token });
  if (signerRole) frameQuery.set("role", signerRole);

  return (
    <div className="flex h-dvh flex-col bg-[#eef3f7]">
      {showCreatorWebsiteHeader ? <DashboardHeader active="/dashboard" /> : null}
      <iframe
        title={`${doc.documentType} signing page`}
        src={`/signing-frame?${frameQuery.toString()}`}
        className="min-h-0 w-full flex-1 border-0"
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
      />
    </div>
  );
}
