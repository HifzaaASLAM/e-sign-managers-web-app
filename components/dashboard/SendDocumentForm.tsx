"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createShmDocumentAction, type CreateDocumentState } from "../../app/dashboard/documents/new/actions";
import Link from "next/link";
import { isCreatorPrepareBeforeRecipientEmail, SHM_DOCUMENT_TYPES } from "../../lib/shm/documents";
function SubmitButton({
  creatorPrepareFirst,
  documentType,
}: {
  creatorPrepareFirst: boolean;
  documentType: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-[#1677ff] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:bg-[#1466e6] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          {creatorPrepareFirst
            ? documentType === "Landlord Weekly Report"
              ? "Opening report…"
              : "Opening agreement…"
            : "Sending document…"}
        </span>
      ) : creatorPrepareFirst ? (
        documentType === "Landlord Weekly Report" ? "Edit and continue" : "Continue to agreement"
      ) : (
        "Send document & email"
      )}
    </button>
  );
}

export function SendDocumentForm() {
  const [state, formAction] = useFormState<CreateDocumentState | null, FormData>(createShmDocumentAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [documentType, setDocumentType] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [addressSuggestOpen, setAddressSuggestOpen] = useState(false);
  const [addressSuggestLoading, setAddressSuggestLoading] = useState(false);
  const addressSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressFieldWrapRef = useRef<HTMLDivElement>(null);
  const [recipientRole, setRecipientRole] = useState("Tenant");
  const [tenantRows, setTenantRows] = useState([{ id: "t1", name: "", email: "" }]);
  const [applicationRows, setApplicationRows] = useState([{ id: "a1", name: "", email: "" }]);
  const isTenantAgreement = documentType === "Tenant Agreement";
  const isTenantApplication = documentType === "Tenant Application";
  const isLandlordWeeklyReport = documentType === "Landlord Weekly Report";
  const creatorPrepareFirst = isCreatorPrepareBeforeRecipientEmail(documentType);

  const tenantRecipientsJson = JSON.stringify(
    tenantRows
      .map((row) => ({
        tenant_name: row.name.trim(),
        tenant_email: row.email.trim().toLowerCase(),
      }))
      .filter((row) => row.tenant_name && row.tenant_email.includes("@")),
  );
  const multiTenantMode = isTenantAgreement && tenantRows.filter((r) => r.name.trim() && r.email.trim()).length >= 2;

  const applicationRecipientsJson = JSON.stringify(
    applicationRows
      .map((row) => ({
        tenant_name: row.name.trim(),
        tenant_email: row.email.trim().toLowerCase(),
      }))
      .filter((row) => row.tenant_name && row.tenant_email.includes("@")),
  );

  useEffect(() => {
    if (documentType === "Property Management Agreement") {
      setRecipientRole("Owner");
    }
    if (documentType === "Landlord Weekly Report") {
      setRecipientRole("Landlord");
    }
  }, [documentType]);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setFormKey((key) => key + 1);
      setApplicationRows([{ id: "a1", name: "", email: "" }]);
    }
  }, [state]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!addressFieldWrapRef.current?.contains(e.target as Node)) {
        setAddressSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function fetchAddressSuggestions(query: string) {
    const trimmed = query.trim();
    if (trimmed.length < (/^\d{4}$/.test(trimmed) ? 4 : 3)) {
      setAddressSuggestions([]);
      setAddressSuggestOpen(false);
      setAddressSuggestLoading(false);
      return;
    }
    setAddressSuggestLoading(true);
    fetch(`/api/address-suggestions?q=${encodeURIComponent(trimmed)}`)
      .then((res) => res.json())
      .then((data: { suggestions?: string[] }) => {
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        setAddressSuggestions(list);
        setAddressSuggestOpen(list.length > 0);
      })
      .catch(() => {
        setAddressSuggestions([]);
        setAddressSuggestOpen(false);
      })
      .finally(() => setAddressSuggestLoading(false));
  }

  function onPropertyAddressChange(value: string) {
    setPropertyAddress(value);
    if (addressSuggestTimer.current) clearTimeout(addressSuggestTimer.current);
    addressSuggestTimer.current = setTimeout(() => fetchAddressSuggestions(value), 220);
  }

  function selectAddressSuggestion(suggestion: string) {
    setPropertyAddress(suggestion);
    setAddressSuggestions([]);
    setAddressSuggestOpen(false);
  }

  return (
    <div>
      {state && (
        <div
          className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
            state.ok
              ? state.emailStatus === "sent"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {state.ok && state.emailStatus === "sent" ? (
            <p className="font-semibold">Document sent</p>
          ) : null}
          <p className={state.ok && state.emailStatus === "sent" ? "mt-1" : ""}>{state.message}</p>
          {state.ok && state.documentId && (
            <p className="mt-1 text-xs opacity-80">Reference: {state.documentId}</p>
          )}
        </div>
      )}

      <form ref={formRef} key={formKey} action={formAction} className="mt-8 space-y-5">
        <div>
          <label className="text-sm font-bold text-slate-800">Document type</label>
          <select
            name="documentType"
            required
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1677ff]"
          >
            <option value="">Select document type</option>
            {SHM_DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          {documentType === "Tenant Agreement" ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Add one renter or several co-renters — each gets their own signing link by email. We open the agreement so you can review, edit, then send.
              Prefer a saved clause set?{" "}
              <Link href="/dashboard/templates" className="font-semibold text-[#1677ff] hover:underline">
                Manage templates
              </Link>
              .
            </p>
          ) : null}
          {isTenantApplication ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Add one or more applicants — each person receives their own Tenant Application link by email (separate document per applicant).
            </p>
          ) : null}
          {documentType === "Property Management Agreement" ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              We open the agreement for you first so you can edit property details, terms, fees, and bank instructions. Use{" "}
              <strong>Send to Owner</strong> on Part F when you are ready — no email is sent from this page.
            </p>
          ) : null}
          {isLandlordWeeklyReport ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Click <strong>Edit and continue</strong> to open the weekly report form (same layout as the PDF). Fill in the fields and click{" "}
              <strong>Send</strong> to email the landlord — no signature required.
            </p>
          ) : null}
        </div>
        {isLandlordWeeklyReport ? (
          <>
            <input type="hidden" name="propertyAddress" value="" />
            <input type="hidden" name="recipientName" value="Landlord" />
            <input type="hidden" name="recipientEmail" value="" />
            <input type="hidden" name="recipientRole" value="Landlord" />
          </>
        ) : (
          <div ref={addressFieldWrapRef} className="relative">
            <label className="text-sm font-bold text-slate-800">Property address</label>
            <input
              name="propertyAddress"
              required={
                documentType !== "Tenant Agreement"
                && documentType !== "Ownership Statement"
              }
              value={propertyAddress}
              onChange={(e) => onPropertyAddressChange(e.target.value)}
              onFocus={() => {
                if (addressSuggestions.length > 0) setAddressSuggestOpen(true);
              }}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={addressSuggestOpen}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1677ff]"
              placeholder="e.g. 10/8 Example Street, suburb…"
            />
            {addressSuggestLoading ? (
              <p className="mt-1 text-xs text-slate-500">Searching addresses…</p>
            ) : null}
            {addressSuggestOpen && addressSuggestions.length > 0 ? (
              <ul
                className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
                role="listbox"
              >
                {addressSuggestions.map((suggestion) => (
                  <li key={suggestion} role="option">
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectAddressSuggestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {isTenantAgreement ? (
          <div className="space-y-3">
            <input type="hidden" name="tenantRecipientsJson" value={tenantRecipientsJson} />
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-bold text-slate-800">Co-renters / tenants</label>
              <button
                type="button"
                onClick={() =>
                  setTenantRows((rows) => [
                    ...rows,
                    { id: `t${Date.now()}`, name: "", email: "" },
                  ])
                }
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-[#1677ff] hover:bg-blue-50"
              >
                + Add tenant
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Add two or more tenants to create one shared agreement. Each person signs only from the link sent to their email, and each signature appears on the final document.
            </p>
            {tenantRows.map((row, index) => (
              <div key={row.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Tenant {index + 1} name
                  </label>
                  <input
                    required={!multiTenantMode && index === 0}
                    value={row.name}
                    onChange={(e) =>
                      setTenantRows((rows) =>
                        rows.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677ff]"
                    placeholder="Renter name"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                      Tenant {index + 1} email
                    </label>
                    <input
                      type="email"
                      required={!multiTenantMode && index === 0}
                      value={row.email}
                      onChange={(e) =>
                        setTenantRows((rows) =>
                          rows.map((r) => (r.id === row.id ? { ...r, email: e.target.value } : r)),
                        )
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677ff]"
                      placeholder="renter@email.com"
                    />
                  </div>
                  {tenantRows.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove tenant ${index + 1}`}
                      onClick={() => setTenantRows((rows) => rows.filter((r) => r.id !== row.id))}
                      className="mt-6 rounded-lg border border-red-200 px-2.5 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {!multiTenantMode ? (
              <>
                <input type="hidden" name="recipientName" value={tenantRows[0]?.name || ""} />
                <input type="hidden" name="recipientEmail" value={tenantRows[0]?.email || ""} />
                <input type="hidden" name="recipientRole" value="Tenant" />
              </>
            ) : (
              <>
                <input type="hidden" name="recipientName" value={tenantRows[0]?.name || "Tenants"} />
                <input type="hidden" name="recipientEmail" value={tenantRows[0]?.email || "tenants@example.com"} />
                <input type="hidden" name="recipientRole" value="Tenant" />
              </>
            )}
          </div>
        ) : isTenantApplication ? (
          <div className="space-y-3">
            <input type="hidden" name="applicationRecipientsJson" value={applicationRecipientsJson} />
            <input type="hidden" name="recipientRole" value="Tenant" />
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-bold text-slate-800">Applicants</label>
              <button
                type="button"
                onClick={() =>
                  setApplicationRows((rows) => [
                    ...rows,
                    { id: `a${Date.now()}`, name: "", email: "" },
                  ])
                }
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-[#1677ff] hover:bg-blue-50"
              >
                + Add applicant
              </button>
            </div>
            {applicationRows.map((row, index) => (
              <div key={row.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Applicant {index + 1} name
                  </label>
                  <input
                    required={index === 0}
                    value={row.name}
                    onChange={(e) =>
                      setApplicationRows((rows) =>
                        rows.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677ff]"
                    placeholder="Applicant name"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
                      Applicant {index + 1} email
                    </label>
                    <input
                      type="email"
                      required={index === 0}
                      value={row.email}
                      onChange={(e) =>
                        setApplicationRows((rows) =>
                          rows.map((r) => (r.id === row.id ? { ...r, email: e.target.value } : r)),
                        )
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1677ff]"
                      placeholder="applicant@email.com"
                    />
                  </div>
                  {applicationRows.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove applicant ${index + 1}`}
                      onClick={() => setApplicationRows((rows) => rows.filter((r) => r.id !== row.id))}
                      className="mt-6 rounded-lg border border-red-200 px-2.5 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : isLandlordWeeklyReport ? null : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-bold text-slate-800">Recipient name</label>
                <input
                  name="recipientName"
                  required
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1677ff]"
                  placeholder="Recipient name"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-800">Recipient email</label>
                <input
                  name="recipientEmail"
                  type="email"
                  required
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1677ff]"
                  placeholder="recipient@email.com"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-bold text-slate-800">Recipient role</label>
              <select
                name="recipientRole"
                required
                value={recipientRole}
                onChange={(e) => setRecipientRole(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#1677ff]"
              >
                <option value="Tenant">Tenant</option>
                <option value="Owner">Owner</option>
                <option value="Rental Provider">Rental Provider</option>
                <option value="Applicant">Applicant</option>
              </select>
            </div>
          </>
        )}
        <div className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          {isLandlordWeeklyReport
            ? "You will edit the weekly report next. The landlord receives the PDF by email when you click Send on that form. No signing is required."
            : creatorPrepareFirst
              ? documentType === "Property Management Agreement"
                ? "You will preview and edit the agreement first. The owner receives the signing email only after you use Send to Owner on Part F. Each signing link works once only."
                : "The signing email is sent after you complete the creator step. Each signing link works once only."
              : isTenantApplication && applicationRows.filter((r) => r.name.trim() && r.email.trim()).length >= 2
                ? "A separate Tenant Application and signing email is sent to each applicant. The creator can sign later from the dashboard. Each signing link works once only."
                : "A signing email is sent immediately to the recipient. The creator can sign later from the dashboard. Each signing link works once only."}
        </div>
        <SubmitButton creatorPrepareFirst={creatorPrepareFirst} documentType={documentType} />
      </form>
    </div>
  );
}
