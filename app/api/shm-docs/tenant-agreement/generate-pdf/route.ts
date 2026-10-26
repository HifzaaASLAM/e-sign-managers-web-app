import { NextResponse } from "next/server";
import { validateShmSignerToken } from "../../../../../lib/shm/documents";
import {
  buildTenantAgreementTemplateData,
  generateTenantAgreementDocxBase64,
} from "../../../../../lib/shm/tenant-agreement-export";
import {
  isMultiTenantAgreementData,
  rentalProviderFromAgreementData,
  rentalProviderSignatureFromSigners,
  tenantSignatureRecordsFromSigners,
  type TenantSignatureRecord,
} from "../../../../../lib/shm/multi-tenant-signatures";

function parseAgreementData(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function tenantSignaturesForGenerate(
  doc: NonNullable<Awaited<ReturnType<typeof validateShmSignerToken>>["document"]>,
  storedData: Record<string, unknown>,
  body: Record<string, unknown>,
  activeSignature?: string,
  activeSigner?: { id?: string; name?: string; email?: string } | null,
): TenantSignatureRecord[] {
  const fromSigners = tenantSignatureRecordsFromSigners(doc.signers);
  const fromStored = Array.isArray(storedData.tenant_signatures)
    ? (storedData.tenant_signatures as TenantSignatureRecord[])
    : [];
  const map = new Map<string, TenantSignatureRecord>();
  for (const row of [...fromStored, ...fromSigners]) {
    if (row.signerId) map.set(row.signerId, row);
  }
  const pendingSig = String(body?.tenant_signature || activeSignature || "").trim();
  if (pendingSig && activeSigner?.id) {
    map.set(activeSigner.id, {
      signerId: activeSigner.id,
      name: String(activeSigner.name || ""),
      email: String(activeSigner.email || ""),
      signature: pendingSig,
      signedAt: new Date().toISOString(),
    });
  }
  return [...map.values()];
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const docId = String(body?.doc_id || "").trim();
    const token = String(body?.token || "").trim();
    const requestData = (body?.agreement_data || body?.field_values || {}) as Record<string, unknown>;
    const activeSigner = (body?.signer || null) as { id?: string; name?: string; email?: string } | null;

    if (!docId || !token) {
      return NextResponse.json({ message: "Missing doc_id or token." }, { status: 400 });
    }

    const validation = await validateShmSignerToken(docId, token);
    if (!validation?.document) {
      return NextResponse.json({ message: "Invalid document or token." }, { status: 403 });
    }

    const doc = validation.document;
    const storedData = parseAgreementData(doc.agreementData);
    const multiTenant = isMultiTenantAgreementData(storedData);
    const ctx = {
      tenantName: doc.tenantName || doc.recipientName,
      tenantEmail: doc.tenantEmail || doc.recipientEmail,
      adminName: doc.adminName,
      adminEmail: doc.adminEmail,
      propertyAddress: doc.propertyAddress,
      adminSignature: doc.adminSignature,
      tenantSignature: doc.tenantSignature,
    };

    const mergedData: Record<string, unknown> = {
      ...storedData,
      ...Object.fromEntries(
        Object.entries(requestData || {}).filter(([, value]) => {
          if (value == null) return false;
          if (typeof value === "string") return value.trim() !== "";
          if (Array.isArray(value)) return value.length > 0;
          return true;
        }),
      ),
    };

    mergedData.tenant_name = pickString(
      mergedData.tenant_name,
      mergedData.tenant_name_field,
      requestData.tenant_name,
      requestData.tenant_name_field,
      ctx.tenantName,
    );
    mergedData.tenant_email = pickString(
      mergedData.tenant_email,
      mergedData.tenant_email_field,
      requestData.tenant_email,
      requestData.tenant_email_field,
      ctx.tenantEmail,
    );
    mergedData.provider_name = pickString(mergedData.provider_name, requestData.provider_name);
    mergedData.provider_email = pickString(
      mergedData.provider_email,
      requestData.provider_email,
      "info@sharehousemanagers.com.au",
    );
    mergedData.premises_address = pickString(
      mergedData.premises_address,
      requestData.premises_address,
      ctx.propertyAddress,
    );
    mergedData.monthly_rent = pickString(mergedData.monthly_rent, requestData.monthly_rent);
    mergedData.weekly_rent = pickString(mergedData.weekly_rent, requestData.weekly_rent);
    mergedData.bond_amount = pickString(mergedData.bond_amount, requestData.bond_amount);
    mergedData.bond_payment_due = pickString(mergedData.bond_payment_due, requestData.bond_payment_due);
    mergedData.commencement_date = pickString(mergedData.commencement_date, requestData.commencement_date);
    mergedData.terminate_date = pickString(mergedData.terminate_date, requestData.terminate_date);
    mergedData.agreement_date = pickString(mergedData.agreement_date, requestData.agreement_date);

    function pickList(key: string) {
      const fromStored = storedData[key];
      const fromReq = requestData[key];
      if (Array.isArray(fromStored) && fromStored.length) return fromStored;
      if (Array.isArray(fromReq) && fromReq.length) return fromReq;
      return fromStored ?? fromReq ?? [];
    }
    function pickText(key: string) {
      return pickString(storedData[key], requestData[key]);
    }

    mergedData.core_sections = pickList("core_sections");
    mergedData.additional_terms = pickList("additional_terms");
    mergedData.share_house_rules = pickList("share_house_rules");
    const rebuilt = buildTenantAgreementTemplateData(mergedData, {
      documentId: doc.documentId,
      signedAt: new Date(),
    });
    const hasTermArray = Array.isArray(mergedData.additional_terms) && (mergedData.additional_terms as unknown[]).length > 0;
    const hasRuleArray = Array.isArray(mergedData.share_house_rules) && (mergedData.share_house_rules as unknown[]).length > 0;
    const hasCoreArray = Array.isArray(mergedData.core_sections) && (mergedData.core_sections as unknown[]).length > 0;
    mergedData.core_sections_text = hasCoreArray ? rebuilt.core_sections : pickText("core_sections_text");
    mergedData.additional_terms_text = hasTermArray ? rebuilt.additional_terms : pickText("additional_terms_text");
    mergedData.additional_share_house_rules = hasRuleArray
      ? rebuilt.additional_share_house_rules
      : pickText("additional_share_house_rules");

    const tenantSignatures = multiTenant
      ? tenantSignaturesForGenerate(
          doc,
          storedData,
          body || {},
          String(body?.tenant_signature || ""),
          activeSigner || validation.signer,
        )
      : [];

    const signingSigner = validation.signer;
    const providerFromSigners = rentalProviderSignatureFromSigners(doc.signers, mergedData);
    const providerPending =
      signingSigner &&
      signingSigner.signerType === "recipient" &&
      /rental provider/i.test(String(signingSigner.role || ""))
        ? String(body?.provider_signature || body?.tenant_signature || "")
        : "";
    const tenantPending =
      signingSigner &&
      signingSigner.signerType === "recipient" &&
      !/rental provider/i.test(String(signingSigner.role || ""))
        ? String(body?.tenant_signature || "")
        : "";
    const tenantFromSigners = doc.signers.find(
      (s) =>
        s.signerType === "recipient" &&
        s.status === "Signed" &&
        !/rental provider/i.test(String(s.role || "")) &&
        String(s.signature || "").trim(),
    );

    const generated = await generateTenantAgreementDocxBase64(mergedData, {
      documentId: doc.documentId,
      signers: doc.signers.map((s) => ({
        signerType: s.signerType,
        role: s.role,
        name: s.name,
        email: s.email,
        status: s.status,
      })),
      tenantSignature: String(
        tenantPending ||
          body?.tenant_signature ||
          tenantFromSigners?.signature ||
          ctx.tenantSignature ||
          tenantSignatures[tenantSignatures.length - 1]?.signature ||
          "",
      ),
      providerSignature: String(
        providerPending || body?.provider_signature || providerFromSigners || "",
      ),
      signedAt: new Date(),
      tenantSignatures,
      providerName: pickString(mergedData.provider_name, rentalProviderFromAgreementData(mergedData)?.name),
      providerEmail: pickString(mergedData.provider_email, rentalProviderFromAgreementData(mergedData)?.email),
      multiTenant: multiTenant || doc.signers.filter((s) => s.signerType === "recipient").length > 1,
    });

    return NextResponse.json({
      ok: true,
      fileContent: generated.base64,
      fileType: generated.mimeType,
      isDocx: generated.isDocx,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate tenant agreement document.";
    console.error("[tenant-agreement/generate-pdf]", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
