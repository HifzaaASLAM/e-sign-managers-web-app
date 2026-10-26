"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDefaultSigningEmailBody,
  getDefaultSigningEmailSubject,
  isTenantApplicationDocumentType,
  renderSigningEmailHtml,
  sanitizeSigningEmailBodyPlain,
  sanitizeSigningEmailSubject,
} from "../../lib/shm/signing-email-templates";
import { isCreatorPrepareBeforeRecipientEmail } from "../../lib/shm/documents";

type SigningEmailEditorProps = {
  documentType: string;
  recipientName: string;
  recipientEmail: string;
  propertyAddress: string;
  initialSubject?: string;
  initialBody?: string;
  /** When false, only hidden fields + note (e.g. TA defers send to admin step). */
  showEditor?: boolean;
};

export function SigningEmailEditor({
  documentType,
  recipientName,
  recipientEmail,
  propertyAddress,
  initialSubject,
  initialBody,
  showEditor = true,
}: SigningEmailEditorProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!documentType) {
      setSubject("");
      setBody("");
      return;
    }
    setSubject(initialSubject || getDefaultSigningEmailSubject(documentType));
    setBody(initialBody || getDefaultSigningEmailBody(documentType));
  }, [documentType, initialSubject, initialBody]);

  const previewHtml = useMemo(() => {
    if (!documentType) return "";
    const name = recipientName.trim() || "Recipient";
    const email = recipientEmail.trim() || "recipient@example.com";
    const address = propertyAddress.trim();
    const hasAttachment = !isTenantApplicationDocumentType(documentType)
      && documentType.toLowerCase().includes("tenant agreement");
    return renderSigningEmailHtml({
      documentType,
      recipientName: name,
      recipientEmail: email,
      signingUrl: "#",
      propertyAddress: address,
      documentId: "PREVIEW",
      subject,
      body,
      preview: true,
      hasAnyAttachment: hasAttachment,
      hasDocxAttachment: hasAttachment,
    });
  }, [documentType, recipientName, recipientEmail, propertyAddress, subject, body]);

  if (!documentType) return null;

  const adminFirst = isCreatorPrepareBeforeRecipientEmail(documentType);
  const sanitizedSubject = sanitizeSigningEmailSubject(subject, documentType);
  const sanitizedBody = sanitizeSigningEmailBodyPlain(body);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:p-5">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Signing email</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {adminFirst
            ? "This is the email the signer will receive after you complete the creator step. You can edit it here and again before sending from the agreement page."
            : "Preview and edit the email sent to the signer. The branded header, signing button, and security footer stay fixed."}
        </p>
      </div>

      <input type="hidden" name="signingEmailSubject" value={sanitizedSubject} />
      <input type="hidden" name="signingEmailBody" value={sanitizedBody} />

      {showEditor ? (
        <>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-600">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677ff]"
            />
          </div>
        </>
      ) : null}

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Live preview</p>
        <div
          className="mt-2 max-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-inner"
          aria-live="polite"
        >
          <iframe
            title="Signing email preview"
            className="h-[380px] w-full border-0"
            srcDoc={previewHtml}
            sandbox=""
          />
        </div>
      </div>
    </div>
  );
}
