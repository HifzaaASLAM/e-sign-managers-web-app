import assert from "node:assert/strict";
import {
  hasStructuredTenantAgreementTemplateContent,
  mergeTemplateAgreementDataOnSave,
  prepareAgreementDataForTemplateEditor,
  templateListShowsAsImportedDocument,
} from "../lib/shm/ta-template-editor";
import { buildImportedTemplateAgreementData } from "../lib/shm/ta-imported-document";

const imported = buildImportedTemplateAgreementData({
  landlordName: "Jordan",
  propertyAddress: "123 Melbourne St",
  fileBase64: "dGVzdA==",
  originalFileName: "agreement.docx",
  format: "docx",
});

assert.equal(templateListShowsAsImportedDocument(imported), true);

const editorData = prepareAgreementDataForTemplateEditor(imported, { adminEmail: "admin@test.com" });
assert.equal(editorData.provider_name, "Jordan");
assert.equal(editorData.premises_address, "123 Melbourne St");
assert.equal(editorData.imported_docx_b64, undefined);

const saved = mergeTemplateAgreementDataOnSave(imported, {
  provider_name: "Jordan",
  premises_address: "123 Melbourne St",
  core_sections: [{ title: "Rent", body: "Details", selected: true }],
  additional_terms: [],
  share_house_rules: [],
});

assert.equal(saved.imported_document, undefined);
assert.equal(templateListShowsAsImportedDocument(saved), false);
assert.equal(hasStructuredTenantAgreementTemplateContent(saved), true);

console.log("test-ta-template-editor: ok");
