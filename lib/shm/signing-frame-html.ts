import { NextResponse } from "next/server";
import { prisma } from "../prisma";
import {
  getAppUrl,
  isLandlordWeeklyReport,
  isOwnershipStatement,
  isPropertyManagementAgreement,
  isTenantApplication,
  signerRoleForToken,
  validateShmToken,
} from "./documents";
import {
  omitTenantApplicationApplicantPrefill,
  TENANT_APPLICATION_APPLICANT_FIELD_IDS,
} from "./tenant-application-prefill";
import { preparePmaAgreementDataForSigningUi } from "./property-management-agreement-fields";
import { isRevokedToken } from "./signing-access";
import { loadSigningTemplateHtml } from "./load-signing-template";
import { LWR_PROPERTY_LANDLORDS } from "./landlord-weekly-report-properties";
import { sanitizeTenantAgreementLandlordFields } from "./ta-templates";
import {
  getDefaultSigningEmailBody,
  getDefaultSigningEmailBodyForRentalProvider,
  getDefaultSigningEmailSubject,
  getDefaultSigningEmailSubjectForRentalProvider,
  readSigningEmailFromAgreement,
  signingEmailContentForRentalProvider,
} from "./signing-email-templates";

export const dynamic = "force-dynamic";

const shmAssetVersion = encodeURIComponent(process.env.NEXT_PUBLIC_SHM_BUILD_ID || "1");

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function signerAlreadySigned(
  doc: NonNullable<Awaited<ReturnType<typeof validateShmToken>>>,
  signerRole: string,
  activeSigner: { status: string } | null,
) {
  if (activeSigner?.status === "Signed") return true;
  if (activeSigner && activeSigner.status !== "Signed" && activeSigner.status !== "Removed") return false;
  const recipientSigners = doc.signers.filter((s) => s.signerType === "recipient" && s.status !== "Removed");
  const multiTenantRecipients = recipientSigners.length > 1;
  if (signerRole === "recipient" && multiTenantRecipients) {
    return activeSigner?.status === "Signed";
  }
  const stored = doc.signers.find((s) => s.signerType === signerRole);
  if (stored?.status === "Signed") return true;
  if (signerRole === "creator" && doc.adminSignedAt) return true;
  if (signerRole === "recipient" && (doc.tenantSignedAt || doc.signedAt)) return true;
  return false;
}

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:24px}section{max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;box-shadow:0 8px 24px rgba(15,23,42,.06)}h1{font-size:22px;margin:0 0 10px}p{font-size:14px;line-height:1.55;color:#475569;margin:0}</style>
</head><body><section>${body}</section></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/** Full signing HTML for iframe — keeps /sign-document shell tiny and loads the heavy form separately. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const docId = String(url.searchParams.get("doc_id") || "").trim();
  const token = String(url.searchParams.get("token") || "").trim();
  const roleParam = String(url.searchParams.get("role") || "").trim();

  if (!docId || !token) {
    return htmlPage("Missing link", "<h1>Invalid signing link</h1><p>Document id or token is missing.</p>", 400);
  }

  const doc = await validateShmToken(docId, token);
  if (!doc) {
    let usedLink = isRevokedToken(token);
    if (!usedLink) {
      const existing = await prisma.shmDocument.findUnique({
        where: { documentId: docId },
        include: { signers: true },
      });
      if (existing) {
        usedLink = existing.signers.some((s) => s.status === "Signed") || Boolean(existing.adminSignedAt || existing.tenantSignedAt);
      }
    }
    return htmlPage(
      usedLink ? "Already used" : "Invalid link",
      usedLink
        ? "<h1>Signing link already used</h1><p>This link has already been used or is no longer valid.</p>"
        : "<h1>Invalid signing link</h1><p>This document link is invalid or expired.</p>",
      403,
    );
  }

  const activeSigner = doc.signers.find((signer) => signer.token === token) || null;
  const signerRole = roleParam || activeSigner?.signerType || signerRoleForToken(doc, token);

  if (signerAlreadySigned(doc, signerRole, activeSigner)) {
    return htmlPage("Already signed", "<h1>You have already signed</h1><p>This signing link is single-use and cannot be reused.</p>");
  }

  if (
    (isOwnershipStatement(doc.documentType) || isLandlordWeeklyReport(doc.documentType))
    && signerRole === "recipient"
  ) {
    const label = isLandlordWeeklyReport(doc.documentType) ? "weekly landlord report" : "ownership statement";
    return htmlPage(
      "No signature required",
      `<h1>No signature required</h1><p>This ${label} was sent for your records. No signature is needed.</p>`,
    );
  }

  const isTenantAgreement = doc.documentType.toLowerCase() === "tenant agreement";

  let agreementData: Record<string, unknown> = {};
  try {
    agreementData = doc.agreementData ? JSON.parse(doc.agreementData) : {};
  } catch {
    agreementData = {};
  }

  if (isPropertyManagementAgreement(doc.documentType)) {
    agreementData = preparePmaAgreementDataForSigningUi(agreementData);
  }
  if (isTenantAgreement) {
    agreementData = sanitizeTenantAgreementLandlordFields(agreementData, {
      adminName: doc.adminName,
      adminEmail: doc.adminEmail,
    });
  }

  // Prefill from reusable applicant profile when the form is still empty.
  if (doc.companyId && doc.recipientEmail) {
    try {
      const profile = await prisma.applicantProfile.findUnique({
        where: {
          companyId_email: {
            companyId: doc.companyId,
            email: doc.recipientEmail.toLowerCase(),
          },
        },
      });
      if (profile?.profileData) {
        let profileFields = JSON.parse(profile.profileData) as Record<string, unknown>;
        const existingFields =
          (agreementData.field_values as Record<string, unknown> | undefined) ||
          (agreementData.fieldValues as Record<string, unknown> | undefined) ||
          {};
        if (isTenantApplication(doc.documentType)) {
          profileFields = omitTenantApplicationApplicantPrefill(profileFields);
        }
        agreementData = {
          ...agreementData,
          field_values: isTenantApplication(doc.documentType)
            ? {
                ...profileFields,
                ...existingFields,
                d_addr: existingFields.d_addr || doc.propertyAddress,
              }
            : {
                ...profileFields,
                ...existingFields,
                e_email: existingFields.e_email || doc.recipientEmail,
                d_addr: existingFields.d_addr || doc.propertyAddress,
              },
        };
      }
    } catch {
      // ignore profile prefill failures
    }
  }

  // Strip bulky embedded files from client bootstrap (keeps first paint fast).
  const slimAgreementData = { ...agreementData };
  delete slimAgreementData.last_submission;
  delete slimAgreementData.fileContent;
  delete slimAgreementData.pdfFileContent;
  delete slimAgreementData.docxFileContent;
  delete slimAgreementData.admin_signature;
  delete slimAgreementData.tenant_signature;
  delete slimAgreementData.provider_signature;

  const appUrl = getAppUrl();
  const signingPageBg = isTenantAgreement ? "#ffffff" : "#eef3f7";
  const recipientSigners = doc.signers.filter((s) => s.signerType === "recipient" && s.status !== "Removed");
  const multiTenantSharedDoc = agreementData.multi_tenant_send === true;
  const multiTenantRecipients = multiTenantSharedDoc || recipientSigners.length > 1;
  const signers = doc.signers.map((signer) => ({
    id: signer.id,
    name: signer.name,
    email: signer.email,
    role: signer.role,
    signerType: signer.signerType,
    status: signer.status,
    signedAt: signer.signedAt,
    signature: signer.status === "Signed" ? signer.signature : null,
  }));
  const storedSigningEmail = readSigningEmailFromAgreement(agreementData);
  const signingEmailDefaults = {
    subject: storedSigningEmail?.subject || getDefaultSigningEmailSubject(doc.documentType),
    body: storedSigningEmail?.body || getDefaultSigningEmailBody(doc.documentType),
  };
  const providerSigningEmail = signingEmailContentForRentalProvider(doc.documentType, doc.agreementData);
  const signingEmailProviderDefaults = {
    subject: providerSigningEmail.subject || getDefaultSigningEmailSubjectForRentalProvider(doc.documentType),
    body: providerSigningEmail.body || getDefaultSigningEmailBodyForRentalProvider(doc.documentType),
  };

  const documentContext = {
    documentType: doc.documentType,
    documentId: doc.documentId,
    status: doc.status,
    propertyAddress: doc.propertyAddress,
    recipientName: doc.recipientName,
    recipientEmail: doc.recipientEmail,
    recipientRole: doc.recipientRole,
    adminName: doc.adminName,
    adminEmail: doc.adminEmail,
    adminSignature: doc.adminSignature,
    tenantSignature: doc.tenantSignature,
    tenantName: doc.tenantName || doc.recipientName,
    tenantEmail: doc.tenantEmail || doc.recipientEmail,
    sentAt: doc.sentAt,
    tenantSentAt: doc.tenantSentAt,
    adminSignedAt: doc.adminSignedAt,
    activeSigner,
    signers,
    agreementData: slimAgreementData,
    multiTenantRecipients,
    multiTenantSharedDoc,
  };

  const successUrl = signerRole === "creator" ? "/dashboard" : "/signing-complete";
  const preserveCreatorAdminSend =
    isTenantAgreement
    || isOwnershipStatement(doc.documentType)
    || isLandlordWeeklyReport(doc.documentType)
    || isPropertyManagementAgreement(doc.documentType);
  const templateHtml = await loadSigningTemplateHtml(doc.documentType);

  const iframeScript = `
    window.SHM_DOC_ID = ${safeScriptJson(doc.documentId)};
    window.SHM_TOKEN = ${safeScriptJson(token)};
    window.SHM_API_URL = '/shm-docs/';
    window.SHM_SUCCESS_URL = ${safeScriptJson(successUrl)};
    window.SHM_SIGNER_ROLE = ${safeScriptJson(signerRole)};
    window.SHM_SIGNER_TYPE = ${safeScriptJson(signerRole)};
    window.SHM_DOCUMENT_CONTEXT = ${safeScriptJson(documentContext)};
    window.SHM_PRESERVE_CREATOR_ADMIN_SEND = ${safeScriptJson(preserveCreatorAdminSend)};
    window.SHM_SIGNING_EMAIL_DEFAULTS = ${safeScriptJson(signingEmailDefaults)};
    window.SHM_SIGNING_EMAIL_PROVIDER_DEFAULTS = ${safeScriptJson(signingEmailProviderDefaults)};
    window.PMA_TEMPLATE_PDF_URL = '/shm-plugin-assets/pdfs/property-management-agreement-template.pdf';
    window.PMA_HEADER_IMAGE_URL = '/shm-plugin-assets/images/property-management-header.png';
    window.SHM_LOGO_URL = '/shm-logo.png?v=${shmAssetVersion}';
    window.OS_HEADER_IMAGE_URL = '/shm-plugin-assets/images/ownership-statement-header.png';
    window.OS_TEMPLATE_DOCX_URL = '/shm-plugin-assets/templates/ownership-statement-template.docx';
    window.LWR_PROPERTY_LANDLORDS = ${safeScriptJson(LWR_PROPERTY_LANDLORDS)};
    window.SHM_TA_APPLICANT_NO_PREFILL = ${safeScriptJson([...TENANT_APPLICATION_APPLICANT_FIELD_IDS])};
    window.shmAgentSignDisplayName = function(value){
      var n = String(value || '').trim();
      if(!n || /^sharehouse\\s*managers?$/i.test(n) || n.toLowerCase() === 'sharehousemanagers') return 'Ishaq M';
      return n;
    };

    // Shared draft vs send locks for all document types:
    // unfinished work stays Draft; once sent, never overwrite back to Draft.
    window.__shmSentDocIds = window.__shmSentDocIds || {};
    window.__shmSendingDocId = window.__shmSendingDocId || null;
    (function seedSentLock(){
      var ctx = window.SHM_DOCUMENT_CONTEXT || {};
      var id = window.SHM_DOC_ID;
      if(!id) return;
      var status = String(ctx.status || '');
      var alreadySent = !!(ctx.sentAt || ctx.adminSignedAt || ctx.tenantSentAt)
        || /^(Sent|Signed|Processing|Viewed|Make Error|Withdrawn)\\b/i.test(status)
        || (/^Awaiting\\s+/i.test(status) && !/^Awaiting\\s+Creator\\b/i.test(status));
      if(alreadySent) window.__shmSentDocIds[id] = true;
    })();
    window.shmShouldSkipDraftSave = function(docId){
      var id = docId || window.SHM_DOC_ID;
      if(!id) return true;
      if(window.__shmSendingDocId && window.__shmSendingDocId === id) return true;
      if(window.__shmSentDocIds && window.__shmSentDocIds[id]) return true;
      var ctx = window.SHM_DOCUMENT_CONTEXT || {};
      if(ctx.sentAt || ctx.adminSignedAt || ctx.tenantSentAt) return true;
      var status = String(ctx.status || '');
      if(/^(Sent|Signed|Processing|Viewed|Make Error|Withdrawn)\\b/i.test(status)) return true;
      if(/^Awaiting\\s+/i.test(status) && !/^Awaiting\\s+Creator\\b/i.test(status)) return true;
      return false;
    };
    window.shmBeginSendLock = function(docId){
      window.__shmSendingDocId = docId || window.SHM_DOC_ID || null;
    };
    window.shmMarkDocSent = function(docId){
      var id = docId || window.SHM_DOC_ID;
      if(!id) return;
      window.__shmSentDocIds = window.__shmSentDocIds || {};
      window.__shmSentDocIds[id] = true;
      if(window.__shmSendingDocId === id) window.__shmSendingDocId = null;
      if(window.SHM_DOCUMENT_CONTEXT && window.SHM_DOC_ID === id){
        window.SHM_DOCUMENT_CONTEXT.status = 'Sent';
        var nowIso = new Date().toISOString();
        window.SHM_DOCUMENT_CONTEXT.sentAt = window.SHM_DOCUMENT_CONTEXT.sentAt || nowIso;
        window.SHM_DOCUMENT_CONTEXT.tenantSentAt = window.SHM_DOCUMENT_CONTEXT.tenantSentAt || nowIso;
        (window.SHM_DOCUMENT_CONTEXT.signers || []).forEach(function(s){
          if(s.signerType === 'recipient') s.status = 'Sent';
        });
      }
    };
    window.shmClearSendLock = function(){
      window.__shmSendingDocId = null;
    };

    function shmCollectFieldSnapshot(){
      var out = {};
      document.querySelectorAll('input, textarea, select').forEach(function(el){
        var key = el.id || el.name;
        if(!key) return;
        if(el.type === 'checkbox') out[key] = !!el.checked;
        else if(el.type === 'radio') { if(el.checked) out[key] = el.value; }
        else if(el.type !== 'file') out[key] = el.value;
      });
      return out;
    }

    function shmIsDocsApiUrl(url){
      return url.indexOf('/shm-docs/') !== -1 || url.indexOf('/api/shm-docs/') !== -1;
    }

    (function(){
      var originalFetch = window.fetch;
      window.fetch = function(input, init){
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          var method = (init && init.method ? init.method : 'GET').toUpperCase();
          if (method === 'POST' && shmIsDocsApiUrl(url) && init && init.body && typeof init.body === 'string' && init.body.length < 1200000 && url.indexOf('property-management-agreement/generate-pdf') === -1 && url.indexOf('property-management-agreement/submit') === -1 && url.indexOf('property-management-agreement/admin-send') === -1 && url.indexOf('landlord-weekly-report/admin-send') === -1) {
            var body = JSON.parse(init.body);
            body.signer_type = window.SHM_SIGNER_TYPE;
            body.signer_role = window.SHM_SIGNER_ROLE;
            body.agreement_data = body.agreement_data || shmCollectFieldSnapshot();
            body.field_values = body.field_values || shmCollectFieldSnapshot();
            body.signer = body.signer || (window.SHM_DOCUMENT_CONTEXT || {}).activeSigner || null;
            init.body = JSON.stringify(body);
          }
        } catch(e) {}
        return originalFetch.call(this, input, init);
      };
    })();

    document.addEventListener('DOMContentLoaded', function(){
      if (window.SHM_LOGO_URL) {
        document.querySelectorAll('.shm-header-logo, .ta-header-logo').forEach(function(img) {
          img.setAttribute('src', window.SHM_LOGO_URL);
          img.setAttribute('alt', '');
        });
        document.querySelectorAll('.shm-header-logo-wrap, .ta-header-logo-wrap').forEach(function(wrap) {
          wrap.setAttribute('aria-label', 'ShareHouse Managers');
        });
      }
      function setVal(id, value){
        var el = document.getElementById(id);
        if(el && value !== undefined && value !== null && value !== ''){
          if(id === 'pma_agent_sign_name' || id === 'provider_name') {
            value = window.shmAgentSignDisplayName(value);
          }
          el.value = value;
          try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
          try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
        }
      }
      var ctx = window.SHM_DOCUMENT_CONTEXT || {};
      var data = ctx.agreementData || {};
      var isPmaDoc = String(ctx.documentType || '').toLowerCase() === 'property management agreement';
      var fieldValues = data.field_values || data.fieldValues || data.agreement_data || data.agreementData || data;
      if (isPmaDoc) {
        fieldValues = Object.assign({}, fieldValues, data);
        ['field_values','fieldValues','last_submission','fileContent','pdfFileContent','docxFileContent','agreement_data','agreementData'].forEach(function(k){ delete fieldValues[k]; });
      }
      var isTenantAgreementEarly = String(ctx.documentType || '').toLowerCase() === 'tenant agreement';
      var isTenantApplicationEarly = String(ctx.documentType || '').toLowerCase() === 'tenant application';
      var taNoPrefill = window.SHM_TA_APPLICANT_NO_PREFILL || [];
      Object.keys(fieldValues || {}).forEach(function(key){
        if(isTenantApplicationEarly && taNoPrefill.indexOf(key) !== -1) return;
        if(isTenantApplicationEarly && key === 'e_sigdt') return;
        if(isTenantAgreementEarly && (key === 'provider_name' || key === 'provider_email')) return;
        if(/^item_\\d+$/.test(key)){
          var val = fieldValues[key];
          var yes = document.getElementById(key + '_yes');
          var no = document.getElementById(key + '_no');
          if(val === 'Yes' && yes) { yes.checked = true; if(typeof syncPmChoiceHighlight === 'function') syncPmChoiceHighlight(yes); }
          if(val === 'No' && no) { no.checked = true; if(typeof syncPmChoiceHighlight === 'function') syncPmChoiceHighlight(no); }
          return;
        }
        setVal(key, fieldValues[key]);
      });
      if (isTenantApplicationEarly && typeof window.hydrateSuburbPostcodeFromPrefilledAddress === 'function') {
        window.hydrateSuburbPostcodeFromPrefilledAddress();
        setTimeout(window.hydrateSuburbPostcodeFromPrefilledAddress, 0);
      }
      if (isTenantApplicationEarly && typeof window.tappApplySignatureDate === 'function') {
        window.tappApplySignatureDate();
      }
      if (isTenantApplicationEarly && window.SHM_SIGNER_TYPE === 'recipient') {
        document.querySelectorAll('#panel-2 input, #panel-2 textarea, #panel-2 select').forEach(function(el) {
          if (el.type === 'checkbox' || el.type === 'radio') el.disabled = true;
          else el.readOnly = true;
        });
        ['d_pm', 'd_pmph', 'd_pmeml', 'd_agency'].forEach(function(id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.readOnly = true;
        });
      }
      if (isPmaDoc) {
        var pmaCanonicalToForm = {
          available_from: 'pma_available_from', available_to: 'pma_available_to', property: 'pma_property',
          block: 'pma_block', section: 'pma_section', division: 'pma_division', eer: 'pma_eer',
          property_type: 'pma_property_type', description: 'pma_description', heating: 'pma_heating',
          hot_water: 'pma_hot_water', dishwasher: 'pma_dishwasher', oven: 'pma_oven', cooktop: 'pma_cooktop',
          warranties: 'pma_warranties', rent_pw: 'pma_rent_pw', commencement: 'pma_commencement',
          lease_term: 'pma_lease_term', keys: 'pma_keys', owner: 'pma_owner', postal_address: 'pma_postal_address',
          phone_ah: 'pma_phone_ah', phone_bh: 'pma_phone_bh', mobile: 'pma_mobile', email: 'pma_email',
          unit_plan_no: 'pma_unit_plan_no', unit_plan_manager: 'pma_unit_plan_manager', unit_phone: 'pma_unit_phone',
          fax: 'pma_fax', deposit_to: 'pma_deposit_to', bank: 'pma_bank', branch: 'pma_branch', bsb: 'pma_bsb',
          account: 'pma_account', repairs: 'pma_repairs', preferred_contact: 'pma_preferred_contact',
          intend_sell: 'pma_intend_sell', building_insurer: 'pma_building_insurer', building_policy: 'pma_building_policy',
          building_renewal: 'pma_building_renewal', contents_insurer: 'pma_contents_insurer', contents_policy: 'pma_contents_policy',
          contents_renewal: 'pma_contents_renewal', landlord_insurer: 'pma_landlord_insurer', landlord_policy: 'pma_landlord_policy',
          landlord_renewal: 'pma_landlord_renewal', emergency_contact: 'pma_emergency_contact', emergency_phone: 'pma_emergency_phone',
          other_instructions: 'pma_other_instructions', special_instructions: 'pma_special_instructions',
          instruction_books: 'pma_instruction_books', hot_water_location: 'pma_hot_water_location', meter_box: 'pma_meter_box',
          water_meter: 'pma_water_meter',           additional_info: 'pma_additional_info', owner_sign_name: 'pma_owner_sign_name',
          sig_date: 'pma_sigdt', agent_sign_name: 'pma_agent_sign_name', agent_sig_date: 'pma_agent_sigdt',
          term_appointment: 'pma_term_appointment', term_management_fees: 'pma_term_management_fees',
          term_termination: 'pma_term_termination', term_keys: 'pma_term_keys', term_insurance: 'pma_term_insurance',
          term_duties: 'pma_term_duties', term_expenditure: 'pma_term_expenditure', term_privacy: 'pma_term_privacy',
          fee_initial_letting: 'pma_fee_initial_letting', fee_advertising: 'pma_fee_advertising',
          fee_quick_rent_sign: 'pma_fee_quick_rent_sign', fee_attendance: 'pma_fee_attendance',
          fee_renegotiation: 'pma_fee_renegotiation', fee_management: 'pma_fee_management',
          fee_monthly_statement: 'pma_fee_monthly_statement', fee_tribunal: 'pma_fee_tribunal', fee_gst: 'pma_fee_gst'
        };
        var pmaFeatureSelects = ['heating', 'hot_water', 'dishwasher', 'oven', 'cooktop', 'warranties'];
        Object.keys(pmaCanonicalToForm).forEach(function(canonical){
          var formId = pmaCanonicalToForm[canonical];
          var val = fieldValues[canonical] || fieldValues[formId];
          if (val === undefined || val === null || val === '') return;
          if (pmaFeatureSelects.indexOf(canonical) !== -1 && typeof window.pmaApplyFeatureSelectValue === 'function') {
            window.pmaApplyFeatureSelectValue(formId, val);
            return;
          }
          setVal(formId, val);
        });
        [
          ['asbestos','pma_asbestos_y','pma_asbestos_n'], ['glass','pma_glass_y','pma_glass_n'],
          ['smoke','pma_smoke_y','pma_smoke_n'], ['structures','pma_structures_y','pma_structures_n']
        ].forEach(function(group){
          var val = String(fieldValues[group[0]] || '').trim();
          if (val === 'Yes') { var yes = document.getElementById(group[1]); if (yes) yes.checked = true; }
          if (val === 'No') { var no = document.getElementById(group[2]); if (no) no.checked = true; }
        });
        ['rates_general','rates_water','land_tax','body_corp','fair_clause','email_statements','pets','groups'].forEach(function(key){
          if (String(fieldValues[key] || '').trim() === 'Yes') {
            var box = document.getElementById('pma_' + key);
            if (box) box.checked = true;
          }
        });
        if (window.SHM_SIGNER_TYPE === 'recipient') {
          document.querySelectorAll('#terms-block textarea, #panel-4 textarea').forEach(function(el){
            el.readOnly = true;
            el.classList.add('pma-client-locked');
          });
          ['pma_deposit_to','pma_bank','pma_branch','pma_bsb','pma_account'].forEach(function(id){
            var bankEl = document.getElementById(id);
            if (bankEl) { bankEl.readOnly = true; bankEl.classList.add('pma-client-locked'); }
          });
          var bankNote = document.getElementById('pma-bank-agency-note');
          if (bankNote) bankNote.style.display = 'block';
          var termsInfo = document.querySelector('#panel-3 .info-box');
          if (termsInfo) {
            termsInfo.innerHTML = '<strong>Terms set by ShareHouse Managers</strong>Part D and Part E are prepared by your property manager. Review them here, then complete your details and sign in Part F.';
          }
        }
        if (typeof pmaBindOwnerToDepositSync === 'function') pmaBindOwnerToDepositSync();
        if (typeof pmaSyncDepositToFromOwner === 'function') pmaSyncDepositToFromOwner();
      }
      var taSaved = ctx.agreementData || {};
      setVal('premises_address', ctx.propertyAddress || taSaved.premises_address);
      setVal('property_address', ctx.propertyAddress);
      setVal('property_name', ctx.propertyAddress);
      setVal('d_addr', ctx.propertyAddress);
      setVal('pma_property', ctx.propertyAddress);
      if (isTenantAgreementEarly) {
        function taSanitizedLandlord(saved) {
          var adminName = String(ctx.adminName || '').trim();
          var adminEmail = String(ctx.adminEmail || '').trim().toLowerCase();
          var name = String(saved.provider_name || '').trim();
          var email = String(saved.provider_email || '').trim().toLowerCase();
          var disp = window.shmAgentSignDisplayName ? window.shmAgentSignDisplayName(adminName) : adminName;
          if (!name || name === adminName || name === disp || /^sharehouse\\s*managers?$/i.test(name)) name = '';
          if (!email || email === adminEmail || email === 'info@sharehousemanagers.com.au') email = '';
          return { name: name, email: email };
        }
        var taFv = taSaved.field_values || taSaved.fieldValues || {};
        var landlord = taSanitizedLandlord(Object.assign({}, taFv, taSaved));
        if (landlord.name) setVal('provider_name', landlord.name);
        if (landlord.email) setVal('provider_email', landlord.email);
      } else {
        setVal('tenant_name_field', ctx.tenantName || ctx.recipientName);
        setVal('tenant_email_field', ctx.tenantEmail || ctx.recipientEmail);
        setVal('owner_name_field', ctx.tenantName || ctx.recipientName);
        setVal('owner_email_field', ctx.tenantEmail || ctx.recipientEmail);
        setVal('landlord_name_field', ctx.tenantName || ctx.recipientName);
        setVal('landlord_email_field', ctx.tenantEmail || ctx.recipientEmail);
        setVal('provider_name', window.shmAgentSignDisplayName(ctx.adminName));
        setVal('provider_email', ctx.adminEmail);
      }

      var recipientSigned = (ctx.signers || []).some(function(s){ return s.signerType === 'recipient' && s.status === 'Signed'; });
      var creatorSigned = (ctx.signers || []).some(function(s){ return s.signerType === 'creator' && s.status === 'Signed'; });
      var isTenantAgreement = isTenantAgreementEarly;
      if (isTenantAgreement && typeof buildAgreementFileBase64 !== 'function') {
        var status = document.getElementById('taStatus');
        if (status) {
          status.textContent = 'This signing page is out of date. Please redeploy the latest app version, then create a new Tenant Agreement.';
          status.className = 'status-msg err';
        }
      }
      var isOwnershipStatement = String(ctx.documentType || '').toLowerCase() === 'ownership statement';
      var isLandlordWeeklyReport = String(ctx.documentType || '').toLowerCase() === 'landlord weekly report';
      var isAdminOnlyReport = isOwnershipStatement || isLandlordWeeklyReport;
      var shouldLockForm = (window.SHM_SIGNER_TYPE === 'creator' && recipientSigned) || (window.SHM_SIGNER_TYPE === 'recipient' && isTenantAgreement && creatorSigned);
      if (shouldLockForm) {
        document.querySelectorAll('#main-form input, #main-form textarea, #main-form select').forEach(function(el){
          var id = el.id || '';
          var name = el.name || '';
          var isSignature = /sig|signature|canvas|file/i.test(id + ' ' + name) || el.type === 'file';
          var isAgentSignatureDetail = id === 'pma_agent_sign_name' || id === 'pma_agent_sigdt';
          if (!isSignature && !isAgentSignatureDetail) { if (el.tagName === 'SELECT') el.disabled = true; else el.readOnly = true; }
        });
      }

      document.querySelectorAll('.info-box').forEach(function(box){
        if (!isAdminOnlyReport && /Admin signs first|receives an email link after the admin/i.test(box.textContent || '')) {
          box.innerHTML = '<strong>Signing flow</strong>This document can be sent before the creator signs. The recipient and creator can sign independently, and the final document is generated after both signatures are complete.';
        }
      });
      if (!window.SHM_PRESERVE_CREATOR_ADMIN_SEND) {
        document.querySelectorAll('button').forEach(function(btn){
          if (btn.id === 'pmaSendOwnerBtn') return;
          if (!isAdminOnlyReport && /Admin Sign|Send to Tenant|Send to Owner/i.test(btn.textContent || '')) btn.textContent = 'Sign Document';
        });
      }

      async function submitIndependentSignature(signatureId, buildPdfFn, defaultPrefix){
        var sig = document.getElementById(signatureId);
        if(!sig || !sig.value){ alert('Please add and confirm your signature first.'); return; }
        var fileContent = '';
        var fileType = 'application/pdf';
        var fileName = defaultPrefix + '-' + ((ctx.activeSigner && ctx.activeSigner.name) || ctx.recipientName || 'Signer').replace(/\\s+/g,'-') + '-' + new Date().toISOString().slice(0,10) + '.pdf';
        if (typeof buildPdfFn === 'function') fileContent = await buildPdfFn();
        if (!fileContent && typeof buildAgreementPdfBase64 === 'function') fileContent = await buildAgreementPdfBase64();
        if (!fileContent && typeof buildStatementPdfBase64 === 'function') fileContent = await buildStatementPdfBase64();
        if (!fileContent) fileContent = sig.value;
        var res = await fetch(window.SHM_API_URL+'signed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doc_id:window.SHM_DOC_ID,token:window.SHM_TOKEN,signature:sig.value,fileName:fileName,fileContent:fileContent,fileType:fileType,agreement_data:shmCollectFieldSnapshot()})});
        if(res.status === 409){
          alert('You have already signed this document. This link can no longer be used.');
          window.location.href = window.SHM_SUCCESS_URL || '/signing-complete';
          return;
        }
        if(!res.ok){
          var errText = await res.text();
          try { var errJson = JSON.parse(errText); alert(errJson.message || errText); } catch(e) { alert(errText); }
          return;
        }
        window.location.href = window.SHM_SUCCESS_URL || '/signing-complete';
      }

      if (!window.SHM_PRESERVE_CREATOR_ADMIN_SEND && !isOwnershipStatement && !isLandlordWeeklyReport) {
        window.adminSendOwnershipStatement = function(){ return submitIndependentSignature('os_signature_data', (typeof buildStatementPdfBase64 === 'function' ? buildStatementPdfBase64 : null), 'Ownership-Statement'); };
        window.ownerSignOwnershipStatement = window.adminSendOwnershipStatement;
      }

      function pickDrawSignatureTab(root) {
        var scope = root || document;
        var tabs = scope.querySelectorAll('.sig-tab');
        for (var i = 0; i < tabs.length; i++) {
          var onclick = tabs[i].getAttribute('onclick') || '';
          if (onclick.indexOf("'draw'") !== -1 || onclick.indexOf('"draw"') !== -1) return tabs[i];
        }
        return tabs[0] || null;
      }

      function activateDefaultDrawSignatureTab() {
        var docType = String((window.SHM_DOCUMENT_CONTEXT || {}).documentType || '').toLowerCase();
        var drawDefaultTypes = [
          'tenant application',
          'tenant agreement',
          'property management agreement',
          'pm takeover form',
          'rental reference form',
        ];
        if (drawDefaultTypes.indexOf(docType) === -1) return;

        if (typeof switchRrSigTab === 'function') {
          var rrBtn = pickDrawSignatureTab(document.querySelector('.rental-reference-shell'));
          if (rrBtn) switchRrSigTab('draw', rrBtn);
          return;
        }
        if (typeof switchPmSigTab === 'function') {
          var pmBtn = pickDrawSignatureTab(document.querySelector('.pm-takeover-shell'));
          if (pmBtn) switchPmSigTab('draw', pmBtn);
          return;
        }
        if (typeof switchTaSigTab === 'function') {
          var taBtn = pickDrawSignatureTab(document.querySelector('.tenant-agreement-shell') || document);
          if (taBtn) switchTaSigTab('draw', taBtn);
          return;
        }
        if (typeof switchSigTab === 'function') {
          var btn = pickDrawSignatureTab(document);
          if (btn) switchSigTab('draw', btn);
        }
      }

      activateDefaultDrawSignatureTab();
      setTimeout(activateDefaultDrawSignatureTab, 0);
      setTimeout(activateDefaultDrawSignatureTab, 250);

      setTimeout(function(){
        fetch('/shm-docs/viewed', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ doc_id: window.SHM_DOC_ID, token: window.SHM_TOKEN }) }).catch(function(){});
      }, 1200);
    });
  `;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${appUrl}/" />
  <link rel="stylesheet" href="/shm-plugin-assets/signing.css?v=${shmAssetVersion}" />
  <style>html,body{margin:0;min-height:100%;background:${signingPageBg};} body{padding:0;} .saas-signing-bar{max-width:1120px;margin:18px auto 0;padding:12px 16px;border:1px solid #dbe2ea;background:#fff;border-radius:18px;font-family:Arial,sans-serif;color:#475569;font-size:13px;box-shadow:0 6px 20px rgba(15,23,42,.06);} .saas-signing-bar strong{color:#0f172a;}</style>
  <script>${iframeScript}</script>
</head>
<body id="shm-signing-wrapper">
  ${templateHtml}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
