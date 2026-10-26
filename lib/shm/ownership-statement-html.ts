import fs from "fs/promises";
import path from "path";
import { buildOwnershipStatementTemplateData } from "./ownership-statement-export";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function resolveHeaderImageDataUri() {
  const candidates = [
    path.join(process.cwd(), "public", "shm-plugin-assets", "images", "ownership-statement-header.png"),
    path.join(process.cwd(), "lib", "shm", "templates", "ownership-statement-header.png"),
    path.join(process.cwd(), "public", "shm-plugin-assets", "images", "image1.png"),
  ];
  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      // try next
    }
  }
  return "";
}

export async function buildOwnershipStatementHtml(data: Record<string, unknown>) {
  const d = buildOwnershipStatementTemplateData(data);
  const headerSrc = await resolveHeaderImageDataUri();
  const signature = String(data.admin_signature || "").trim();
  const signatureDate = esc(d.ownership_payment_date || d.generated_on);
  const paidOwner = esc(d.summary_paid_to_owner);
  const feeTotal = esc(d.fee_total);

  const rentRows = (d.rent_rows as Array<Record<string, string>>)
    .map(
      (row) => `<tr>
        <td>${esc(row.rent_property)}</td>
        <td>${esc(row.rent_tenancy)}</td>
        <td>${esc(row.rent_amount)}</td>
        <td>${esc(row.rent_paid_from)}</td>
        <td>${esc(row.rent_paid_to)}</td>
        <td>${esc(row.rent_total)}</td>
      </tr>`,
    )
    .join("");

  const maintenanceRows = (d.maintenance_rows as Array<Record<string, string>>)
    .map(
      (row) => `<tr>
        <td>${esc(row.maintenance_date)}</td>
        <td>${esc(row.maintenance_inv)}</td>
        <td>${esc(row.maintenance_description)}</td>
        <td>$0.00</td>
        <td></td>
        <td>$${esc(row.maintenance_total)}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  const signatureBlock = signature
    ? `<img src="${signature}" alt="Signature" style="max-height:70px;max-width:220px;display:block;margin:8px 0 4px auto;">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 12mm; }
    body { margin:0; padding:24px 28px 32px; background:#fff; color:#1f2937; font-family:Calibri, Arial, sans-serif; font-size:11px; line-height:1.35; }
    .header-img { width:100%; height:auto; display:block; margin:0 0 14px; }
    .title { font-size:20px; font-weight:700; color:#2f5496; text-transform:uppercase; margin:8px 0 12px; letter-spacing:.3px; }
    .meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin-bottom:14px; font-size:11px; }
    .meta-label { font-weight:700; margin-right:8px; color:#111827; }
    .owner-block { margin:12px 0 18px; font-size:11px; line-height:1.55; }
    .section-title { font-size:13px; font-weight:700; color:#2f5496; text-transform:uppercase; margin:18px 0 8px; letter-spacing:.2px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:6px; font-size:10.5px; }
    th, td { border:1px solid #cbd5e1; padding:5px 6px; vertical-align:top; word-break:break-word; }
    th { background:#f3f4f6; color:#2f5496; font-weight:700; text-transform:uppercase; font-size:9.5px; }
    .subtotal td { font-weight:700; background:#fafafa; }
    .total td { font-weight:700; background:#eef2ff; color:#1e3a8a; }
    .footer { margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:20px; font-size:11px; }
    .signature { text-align:right; min-width:240px; }
  </style>
</head>
<body>
  ${headerSrc ? `<img class="header-img" src="${headerSrc}" alt="ShareHouse Managers">` : ""}
  <div class="title">${esc(d.statement_heading)}</div>
  <div class="meta-grid">
    <div><span class="meta-label">STATEMENT PERIOD</span>${esc(d.statement_period)}</div>
    <div><span class="meta-label">OWNERSHIP ID:</span>${esc(d.ownership_id)}</div>
    <div><span class="meta-label">OPENING BALANCE:</span>${esc(d.opening_balance)}</div>
    <div><span class="meta-label">CLOSING BALANCE:</span>${esc(d.closing_balance)}</div>
    <div><span class="meta-label">OWNERSHIP PAYMENT:</span>${paidOwner}</div>
  </div>
  <div class="owner-block">
    <div><strong>Name:</strong> ${esc(d.owner_name)}</div>
    <div><strong>Company Name:</strong> ${esc(d.company_name)}</div>
    <div><strong>Address:</strong> ${esc(d.owner_address)}</div>
    <div><strong>Phone:</strong> ${esc(d.owner_phone)}</div>
    <div><strong>Email:</strong> ${esc(d.owner_email)}</div>
  </div>

  <div class="section-title">RENT INCOME SUMMARY FOR PERIOD</div>
  <table>
    <thead><tr><th>Property</th><th>Tenancy</th><th>Rent period amount</th><th>Paid From</th><th>Paid To</th><th>Total</th></tr></thead>
    <tbody>${rentRows}</tbody>
    <tfoot><tr class="total"><td colspan="5">Total rent for period</td><td>${esc(d.total_rent)}</td></tr></tfoot>
  </table>

  <div class="section-title">TOTAL FEES PAID/CREDITED IN PERIOD</div>
  <table>
    <thead><tr><th>Fee</th><th>GST Paid</th><th>MONEY OUT</th><th>MONEY IN</th></tr></thead>
    <tbody>
      <tr><td>${esc(d.fee_label)}</td><td>${esc(d.fee_gst)}</td><td>${esc(d.fee_money_out)}</td><td></td></tr>
      <tr class="subtotal"><td colspan="2">SUBTOTAL</td><td>${esc(d.summary_management_fees)}</td><td>$0.00</td></tr>
    </tbody>
    <tfoot><tr class="total"><td colspan="3">Total Fees paid in period</td><td>${feeTotal}</td></tr></tfoot>
  </table>

  <div class="section-title">PROPERTY MAINTENANCE EXPENSIS</div>
  <table>
    <thead><tr><th>Date</th><th>INV#</th><th>Description</th><th>GST</th><th>Paid</th><th>MONEY OUT</th><th>MONEY IN</th></tr></thead>
    <tbody>${maintenanceRows}</tbody>
    <tfoot><tr class="total"><td colspan="5">TOTAL PAID TO LANDLORD OR</td><td>${esc(d.summary_maintenance)}</td><td></td></tr></tfoot>
  </table>

  <div class="section-title">OWNERSHIP PAYMENTS</div>
  <table>
    <thead><tr><th>Date</th><th>INV#</th><th>Description</th><th>GST</th><th>Paid</th><th>MONEY OUT</th><th>MONEY IN</th></tr></thead>
    <tbody>
      <tr>
        <td>${esc(d.ownership_payment_date)}</td>
        <td>${esc(d.ownership_payment_ref)}</td>
        <td>${esc(d.ownership_payment_description)}</td>
        <td>$0.00</td>
        <td></td>
        <td>${esc(d.total_fees_maintenance)}</td>
        <td>${esc(d.summary_rental_payments)}</td>
      </tr>
      <tr class="subtotal"><td colspan="4">SUBTOTAL</td><td>${paidOwner}</td><td></td><td></td></tr>
    </tbody>
    <tfoot><tr class="total"><td colspan="5">TOTAL PAID TO LANDLORD OR</td><td>${paidOwner}</td><td></td></tr></tfoot>
  </table>

  <div class="section-title">PROPERTY INCOME, EXPENSIS &amp; OWNERSHIP SUMMARY</div>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>MONEY OUT</th><th>MONEY IN</th></tr></thead>
    <tbody>
      <tr><td></td><td>Rental Payments</td><td></td><td>${esc(d.summary_rental_payments)}</td></tr>
      <tr><td></td><td>Management Fees (inc. GST)</td><td>${esc(d.summary_management_fees)}</td><td></td></tr>
      <tr><td></td><td>Property Maintenance</td><td>${esc(d.summary_maintenance)}</td><td></td></tr>
      <tr><td></td><td>Paid To owner</td><td>${paidOwner}</td><td></td></tr>
      <tr class="subtotal"><td></td><td>SUBTOTAL</td><td>${esc(d.summary_rental_payments)}</td><td>${esc(d.summary_rental_payments)}</td></tr>
    </tbody>
    <tfoot>
      <tr class="total"><td colspan="2">Total ownership payments</td><td colspan="2">${paidOwner}</td></tr>
      <tr class="total"><td colspan="2">Total Paid to owner</td><td colspan="2">${esc(d.summary_paid_to_owner_negative)}</td></tr>
      <tr class="total"><td colspan="2">CLOSING (CARRIED FORWARD) BALANCE</td><td colspan="2">${esc(d.closing_balance)}</td></tr>
    </tfoot>
  </table>

  <div class="footer">
    <div>Generated on ${esc(d.generated_on)}</div>
    <div class="signature">
      <strong>Authorised Signature</strong>
      ${signatureBlock}
      <div>Date: ${signatureDate}</div>
    </div>
  </div>
</body>
</html>`;
}
