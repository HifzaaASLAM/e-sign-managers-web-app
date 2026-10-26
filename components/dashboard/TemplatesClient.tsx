"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreatorSignatureCapture,
  getCreatorSignatureValue,
  initSignatureCanvas,
  type CreatorSignatureMode,
} from "./CreatorSignatureCapture";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  importedDocument?: boolean;
  premisesAddress?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BulkResult = {
  ok: boolean;
  tenant_name: string;
  tenant_email: string;
  documentId?: string;
  message?: string;
};

function downloadBase64File(base64: string, fileName: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

function isAcceptedImportFile(file: File) {
  const lower = file.name.toLowerCase();
  const mime = (file.type || "").toLowerCase();
  if (lower.endsWith(".pdf") || mime === PDF_MIME) return true;
  if (lower.endsWith(".docx") || mime === DOCX_MIME) return true;
  if (mime === "application/octet-stream" && (lower.endsWith(".pdf") || lower.endsWith(".docx"))) return true;
  return false;
}

async function parseJsonResponse(res: Response) {
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw?.trim() || "Server returned an empty response. Redeploy the latest build and try again.");
  }
  return { json, res };
}

export function TemplatesClient({ initialTemplates }: { initialTemplates: TemplateRow[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [landlordName, setLandlordName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [useId, setUseId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [premises, setPremises] = useState("");
  const [useMultiTenant, setUseMultiTenant] = useState(false);
  const [useRecipientsText, setUseRecipientsText] = useState("");
  const [useBulkResults, setUseBulkResults] = useState<BulkResult[] | null>(null);
  const [useBulkSummary, setUseBulkSummary] = useState("");
  const [useLandlordName, setUseLandlordName] = useState("");
  const [useLandlordEmail, setUseLandlordEmail] = useState("");

  const [bulkId, setBulkId] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [bulkSummary, setBulkSummary] = useState("");
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const useSigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [signatureMode, setSignatureMode] = useState<CreatorSignatureMode>("draw");
  const [uploadedSignatureDataUrl, setUploadedSignatureDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setTemplates(initialTemplates);
  }, [initialTemplates]);

  function resetCreatorSignatureFields() {
    setSignatureMode("draw");
    setUploadedSignatureDataUrl(null);
    initSignatureCanvas(sigCanvasRef.current);
    initSignatureCanvas(useSigCanvasRef.current);
  }

  function getActiveCreatorSignature() {
    const canvas = useId && useIsImported ? useSigCanvasRef.current : sigCanvasRef.current;
    return getCreatorSignatureValue(signatureMode, uploadedSignatureDataUrl, canvas);
  }

  useEffect(() => {
    if (!bulkId) return;
    resetCreatorSignatureFields();
  }, [bulkId]);

  const useTemplateRow = templates.find((t) => t.id === useId);
  const useIsImported = Boolean(useTemplateRow?.importedDocument);

  useEffect(() => {
    if (!useId || !useIsImported) return;
    resetCreatorSignatureFields();
    if (useTemplateRow?.premisesAddress) setPremises(useTemplateRow.premisesAddress);
  }, [useId, useIsImported, useTemplateRow?.premisesAddress]);

  async function importDocumentTemplate() {
    const landlord = landlordName.trim();
    const address = propertyAddress.trim();
    if (!landlord) {
      setError("Landlord name is required.");
      return;
    }
    if (!address) {
      setError("Property address is required.");
      return;
    }
    if (!importFile) {
      setError("Choose a PDF or Word document (.pdf or .docx) to import.");
      return;
    }
    if (!isAcceptedImportFile(importFile)) {
      setError("Only PDF (.pdf) and Word (.docx) files can be imported.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("landlord_name", landlord);
      form.set("property_address", address);
      form.set("document", importFile);
      const res = await fetch("/api/shm-templates/import", { method: "POST", body: form });
      const { json } = await parseJsonResponse(res);
      const template = json.template as TemplateRow | undefined;
      if (!res.ok || !json.ok || !template?.id) {
        throw new Error(String(json.message || "Could not import document."));
      }
      setTemplates((prev) => [template, ...prev]);
      setImporting(false);
      setLandlordName("");
      setPropertyAddress("");
      setImportFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import document.");
    } finally {
      setBusy(false);
    }
  }

  async function createTemplate() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a template name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/shm-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, description, agreementData: {} }),
      });
      const { json } = await parseJsonResponse(res);
      const template = json.template as { id?: string } | undefined;
      if (!res.ok || !json.ok || !template?.id) {
        throw new Error(String(json.message || "Could not create template."));
      }
      router.push(`/dashboard/templates/${template.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create template.");
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/shm-templates/${id}`, { method: "DELETE" });
      const { json } = await parseJsonResponse(res);
      if (!res.ok || !json.ok) throw new Error(String(json.message || "Could not delete template."));
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (bulkId === id) setBulkId(null);
      if (useId === id) setUseId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete template.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicateTemplate(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/shm-templates/${id}/duplicate`, { method: "POST" });
      const { json } = await parseJsonResponse(res);
      const template = json.template as TemplateRow | undefined;
      if (!res.ok || !json.ok || !template?.id) {
        throw new Error(String(json.message || "Could not duplicate template."));
      }
      setTemplates((prev) => [template, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not duplicate template.");
    } finally {
      setBusy(false);
    }
  }

  async function exportTemplate(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/shm-templates/${id}/export`, { method: "POST" });
      const { json } = await parseJsonResponse(res);
      if (!res.ok || !json.ok || !json.fileContent) {
        throw new Error(String(json.message || "Could not export template."));
      }
      downloadBase64File(
        String(json.fileContent),
        String(json.fileName || "template-export.docx"),
        String(json.fileType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export template.");
    } finally {
      setBusy(false);
    }
  }

  function resetUsePanelState() {
    setUseMultiTenant(false);
    setUseRecipientsText("");
    setUseBulkResults(null);
    setUseBulkSummary("");
    setUseLandlordName("");
    setUseLandlordEmail("");
    setTenantName("");
    setTenantEmail("");
    setPremises("");
    resetCreatorSignatureFields();
  }

  async function useTemplateBulk() {
    if (!useId) return;
    const adminSignature = getActiveCreatorSignature();
    if (!useRecipientsText.trim()) {
      setError("Paste at least one recipient line: Name, Email, Premises (optional).");
      return;
    }
    setBusy(true);
    setError("");
    setUseBulkResults(null);
    setUseBulkSummary("");
    try {
      const res = await fetch(`/api/shm-templates/${useId}/bulk-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients_text: useRecipientsText,
          admin_signature: adminSignature || undefined,
          landlord_name: useLandlordName.trim() || undefined,
          landlord_email: useLandlordEmail.trim() || undefined,
        }),
      });
      const { json } = await parseJsonResponse(res);
      const results = (json.results as BulkResult[]) || [];
      setUseBulkResults(results);
      setUseBulkSummary(String(json.message || ""));
      if (!results.length && !json.ok) {
        throw new Error(String(json.message || "Could not send to tenants."));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send to tenants.");
    } finally {
      setBusy(false);
    }
  }

  async function useTemplate() {
    if (!useId) return;
    if (useMultiTenant) {
      await useTemplateBulk();
      return;
    }
    if (!tenantName.trim() || !tenantEmail.trim()) {
      setError("Tenant name and email are required.");
      return;
    }
    const adminSignature = useIsImported ? getActiveCreatorSignature() : "";
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/shm-templates/${useId}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_name: tenantName.trim(),
          tenant_email: tenantEmail.trim(),
          premises_address: premises.trim(),
          admin_signature: adminSignature || undefined,
        }),
      });
      const { json } = await parseJsonResponse(res);
      if (!res.ok || !json.ok) throw new Error(String(json.message || "Could not start agreement."));
      if (json.sent) {
        window.location.href = String(json.redirectTo || "/dashboard");
        return;
      }
      window.location.href = String(json.creatorSigningUrl || json.redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start agreement.");
      setBusy(false);
    }
  }

  async function bulkSend() {
    if (!bulkId) return;
    const signature = getActiveCreatorSignature();
    if (!bulkText.trim()) {
      setError("Paste at least one recipient line: Name, Email, Premises (optional).");
      return;
    }
    setBusy(true);
    setError("");
    setBulkResults(null);
    setBulkSummary("");
    try {
      const res = await fetch(`/api/shm-templates/${bulkId}/bulk-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients_text: bulkText,
          admin_signature: signature || undefined,
        }),
      });
      const { json } = await parseJsonResponse(res);
      const results = (json.results as BulkResult[]) || [];
      setBulkResults(results);
      setBulkSummary(String(json.message || ""));
      if (!results.length && !json.ok) {
        throw new Error(String(json.message || "Could not bulk send."));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bulk send.");
    } finally {
      setBusy(false);
    }
  }

  const bulkTemplateName = templates.find((t) => t.id === bulkId)?.name;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Templates</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Save reusable Tenant Agreement content (details, clauses, and house rules). Use a template anytime to send a new agreement to another tenant — only update signer details.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setImporting(true);
              setCreating(false);
              setError("");
            }}
            className="inline-flex rounded-md border border-[#f47a21] bg-white px-5 py-2.5 text-sm font-semibold text-[#d96512] hover:bg-orange-50"
          >
            Import document
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setImporting(false);
              setError("");
            }}
            className="inline-flex rounded-md bg-[#f47a21] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#d96512]"
          >
            New template
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : null}

      {importing ? (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Import document</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload a completed Tenant Agreement as PDF or Word (.pdf or .docx). The landlord name becomes the template name; property address is saved for every send.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Landlord name</span>
              <input
                value={landlordName}
                onChange={(e) => setLandlordName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Rental provider / landlord"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-semibold text-slate-700">Property address</span>
              <textarea
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Full premises address"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-semibold text-slate-700">Document (.pdf or .docx)</span>
              <input
                type="file"
                accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={importDocumentTemplate}
              className="rounded-md bg-[#f47a21] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d96512] disabled:opacity-60"
            >
              {busy ? "Importing…" : "Save template"}
            </button>
            <button
              type="button"
              onClick={() => {
                setImporting(false);
                setImportFile(null);
              }}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {creating ? (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Create template</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="e.g. Standard 3-month share house"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Description (optional)</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Short note for your team"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={createTemplate}
              className="rounded-md bg-[#f47a21] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d96512] disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create & edit content"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {useId ? (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Use template — new Tenant Agreement</h2>
          <p className="mt-1 text-sm text-slate-500">
            {useIsImported
              ? useMultiTenant
                ? "Imported document — paste multiple tenants, sign once, and email each agreement."
                : "Imported document template — enter tenant details and sign to email the agreement."
              : "Template content is copied. Enter the tenant for this send."}
          </p>
          <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setUseMultiTenant(false);
                setUseBulkResults(null);
                setUseBulkSummary("");
                setError("");
              }}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                !useMultiTenant ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              One tenant
            </button>
            <button
              type="button"
              onClick={() => {
                setUseMultiTenant(true);
                setError("");
              }}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                useMultiTenant ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Multiple tenants
            </button>
          </div>
          {useMultiTenant ? (
            <>
              <div className="mt-4 block text-sm sm:col-span-2">
                <span className="mb-1 block font-semibold text-slate-700">Property address (default for all)</span>
                {useIsImported ? (
                  <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-700">
                    {premises || useTemplateRow?.premisesAddress || "—"}
                  </p>
                ) : (
                  <input
                    value={premises}
                    onChange={(e) => setPremises(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder={useTemplateRow?.premisesAddress || "e.g. 1/17 Shady Grove, Nunawading"}
                  />
                )}
              </div>
              <label className="mt-4 block text-sm">
                <span className="mb-1 block font-semibold text-slate-700">Tenants</span>
                <p className="mb-2 text-xs text-slate-500">
                  One per line: <span className="font-medium text-slate-700">Name, Email, Premises address</span> (premises optional — uses the property address above when blank).
                </p>
                <textarea
                  value={useRecipientsText}
                  onChange={(e) => setUseRecipientsText(e.target.value)}
                  rows={8}
                  placeholder={"Alex Tenant, alex@email.com\nSam Tenant, sam@email.com, Unit 2"}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
                />
              </label>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-semibold text-slate-700">Send to landlord</span>
                  <p className="mb-2 text-xs text-slate-500">
                    Optional. The landlord gets their own signing link and appears on the shared agreement PDF.
                  </p>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold text-slate-700">Landlord name</span>
                  <input
                    value={useLandlordName}
                    onChange={(e) => setUseLandlordName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Landlord full name"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold text-slate-700">Landlord email</span>
                  <input
                    type="email"
                    value={useLandlordEmail}
                    onChange={(e) => setUseLandlordEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="landlord@email.com"
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-slate-700">Tenant name</span>
                <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-slate-700">Tenant email</span>
                <input type="email" value={tenantEmail} onChange={(e) => setTenantEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
              </label>
              {useIsImported ? (
                <div className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-semibold text-slate-700">Property address</span>
                  <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-700">
                    {premises || useTemplateRow?.premisesAddress || "—"}
                  </p>
                </div>
              ) : (
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-semibold text-slate-700">Premises address (optional override)</span>
                  <textarea value={premises} onChange={(e) => setPremises(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
              )}
            </div>
          )}
          {useIsImported || useMultiTenant ? (
            <div className="mt-4">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Your creator signature <span className="font-normal text-slate-500">(optional)</span></span>
              <CreatorSignatureCapture
                canvasRef={useSigCanvasRef}
                mode={signatureMode}
                onModeChange={setSignatureMode}
                uploadedDataUrl={uploadedSignatureDataUrl}
                onUploadedDataUrlChange={setUploadedSignatureDataUrl}
                onInitDraw={() => initSignatureCanvas(useSigCanvasRef.current)}
              />
            </div>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={useTemplate}
              className="rounded-md bg-[#f47a21] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d96512] disabled:opacity-60"
            >
              {busy
                ? useIsImported
                  ? useMultiTenant
                    ? "Sending…"
                    : "Sending…"
                  : "Opening…"
                : useMultiTenant
                  ? "Send to tenants & landlord"
                  : useIsImported
                    ? "Send to tenant"
                    : "Open agreement form"}
            </button>
            <button
              type="button"
              onClick={() => {
                setUseId(null);
                resetUsePanelState();
              }}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
          {useBulkSummary ? <p className="mt-3 text-sm font-medium text-slate-800">{useBulkSummary}</p> : null}
          {useBulkResults?.length ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
              {useBulkResults.map((r) => (
                <li key={`${r.tenant_email}-${r.documentId || r.message}`} className={r.ok ? "text-slate-700" : "text-red-700"}>
                  {r.ok ? "✓" : "✗"} {r.tenant_name} &lt;{r.tenant_email}&gt;
                  {r.documentId ? ` · ${r.documentId}` : ""}
                  {r.message ? ` — ${r.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {bulkId ? (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Bulk send contracts{bulkTemplateName ? ` — ${bulkTemplateName}` : ""}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Paste one tenant per line: <span className="font-medium text-slate-700">Name, Email, Premises address</span> (premises optional). Your signature is applied to every agreement, then signing emails are sent.
          </p>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">Recipients</span>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={8}
              placeholder={"Alex Tenant, alex@email.com, 12 Example St Brisbane\nSam Tenant, sam@email.com"}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
            />
          </label>
          <div className="mt-4">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Your creator signature <span className="font-normal text-slate-500">(optional)</span></span>
            <CreatorSignatureCapture
              canvasRef={sigCanvasRef}
              mode={signatureMode}
              onModeChange={setSignatureMode}
              uploadedDataUrl={uploadedSignatureDataUrl}
              onUploadedDataUrlChange={setUploadedSignatureDataUrl}
              onInitDraw={() => initSignatureCanvas(sigCanvasRef.current)}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={bulkSend}
              className="rounded-md bg-[#f47a21] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d96512] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send all"}
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkId(null);
                setBulkResults(null);
                setBulkSummary("");
                resetCreatorSignatureFields();
              }}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
          </div>
          {bulkSummary ? <p className="mt-3 text-sm font-medium text-slate-800">{bulkSummary}</p> : null}
          {bulkResults?.length ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
              {bulkResults.map((r) => (
                <li key={`${r.tenant_email}-${r.documentId || r.message}`} className={r.ok ? "text-slate-700" : "text-red-700"}>
                  {r.ok ? "✓" : "✗"} {r.tenant_name} &lt;{r.tenant_email}&gt;
                  {r.documentId ? ` · ${r.documentId}` : ""}
                  {r.message ? ` — ${r.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">No templates yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Create a template once, then reuse it for every new tenant instead of rebuilding clauses each time.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Template</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr key={t.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <p className="font-bold text-slate-950">{t.name}</p>
                    {t.importedDocument ? (
                      <p className="mt-1 text-xs font-medium text-[#d96512]">Imported document</p>
                    ) : null}
                    {t.description ? <p className="mt-1 text-xs text-slate-500">{t.description}</p> : null}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {new Date(t.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setUseId(t.id);
                          setBulkId(null);
                          resetUsePanelState();
                          if (t.premisesAddress) setPremises(t.premisesAddress);
                          if (t.importedDocument) setUseMultiTenant(true);
                          setError("");
                        }}
                        className="rounded-md bg-[#f47a21] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d96512]"
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setBulkId(t.id);
                          setUseId(null);
                          setBulkResults(null);
                          setBulkSummary("");
                          setError("");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Bulk send
                      </button>
                      <Link
                        href={`/dashboard/templates/${t.id}/edit`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => duplicateTemplate(t.id)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => exportTemplate(t.id)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Export PDF
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deleteTemplate(t.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
