import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { getWorkspaceByEmail } from "../../../../lib/workspace";
import { createShmDocument } from "../../../../lib/shm/create-shm-document";
import { isOwnershipStatement, isPropertyManagementAgreement } from "../../../../lib/shm/documents";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: "Please log in again.", redirectTo: "/login" }, { status: 401 });
    }

    const { user, company } = await getWorkspaceByEmail(session.user.email);
    if (!user || !company) {
      return NextResponse.json({ ok: false, message: "Workspace not found. Please register again.", redirectTo: "/register" }, { status: 403 });
    }

    const formData = await request.formData();
    const documentType = String(formData.get("documentType") || "").trim();
    const propertyAddress = String(formData.get("propertyAddress") || "").trim();
    const recipientName = String(formData.get("recipientName") || "").trim();
    const recipientEmail = String(formData.get("recipientEmail") || "").trim().toLowerCase();
    const recipientRole = String(formData.get("recipientRole") || "").trim();
    const signingEmailSubject = String(formData.get("signingEmailSubject") || "").trim();
    const signingEmailBody = String(formData.get("signingEmailBody") || "").trim();

    if (!documentType) {
      return NextResponse.json({ ok: false, message: "Please select a document type." }, { status: 400 });
    }

    const result = await createShmDocument({
      companyId: company.id,
      user: { id: user.id, name: user.name, email: user.email },
      documentType,
      propertyAddress,
      recipientName,
      recipientEmail,
      recipientRole,
      signingEmailSubject,
      signingEmailBody,
      request,
    });

    if (result.adminFirst && result.creatorSigningUrl) {
      let openingMessage = `Document created (${result.documentId}). Opening the creator signing form.`;
      if (isPropertyManagementAgreement(documentType)) {
        openingMessage = `Document created (${result.documentId}). Edit the agreement, then use Send to Owner on Part F.`;
      } else if (isOwnershipStatement(documentType)) {
        openingMessage = `Document created (${result.documentId}). Opening the Ownership Statement form.`;
      }
      return NextResponse.json({
        ok: true,
        emailStatus: "skipped",
        documentId: result.documentId,
        recipientEmail: result.recipientEmail,
        creatorSigningUrl: result.creatorSigningUrl,
        message: openingMessage,
      });
    }

    if (result.emailStatus === "sent") {
      return NextResponse.json({
        ok: true,
        emailStatus: "sent",
        documentId: result.documentId,
        recipientEmail: result.recipientEmail,
        message: `Document sent successfully. A signing email was delivered to ${result.recipientEmail}.`,
      });
    }

    if (result.emailStatus === "skipped") {
      return NextResponse.json({
        ok: true,
        emailStatus: "skipped",
        documentId: result.documentId,
        recipientEmail: result.recipientEmail,
        message: `Document created (${result.documentId}), but email was not sent. ${result.emailMessage || "Configure RESEND_API_KEY and EMAIL_FROM."}`,
      });
    }

    return NextResponse.json({
      ok: true,
      emailStatus: "error",
      documentId: result.documentId,
      recipientEmail: result.recipientEmail,
      message: `Document created (${result.documentId}), but the email failed: ${result.emailMessage || "Unknown error."}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    return NextResponse.json({ ok: false, message: `Could not create document: ${message}` }, { status: 500 });
  }
}
