import fs from "fs/promises";
import path from "path";
import { buildLandlordWeeklyReportTemplateData } from "./landlord-weekly-report-export";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(value: unknown) {
  const text = esc(value);
  return text ? text.replace(/\n/g, "<br>") : "&nbsp;";
}

async function imageDataUri(fileName: string) {
  const candidates = [
    path.join(process.cwd(), "public", "shm-plugin-assets", "images", fileName),
    path.join(process.cwd(), "..", "public", "shm-plugin-assets", "images", fileName),
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

export async function buildLandlordWeeklyReportHtml(data: Record<string, unknown>) {
  const d = buildLandlordWeeklyReportTemplateData(data);
  const header = await imageDataUri("lwr-header.png");
  const footer = await imageDataUri("lwr-footer.png");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 12mm 12mm 8mm; }
    body { margin:0; padding:0; background:#fff; color:#23313f; font-family:Calibri, Arial, sans-serif; font-size:11px; }
    .banner, .footer-banner { width:100%; height:auto; display:block; }
    .banner { margin:0 0 14px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    td, th { padding:6px 8px; vertical-align:middle; font-size:11px; font-weight:normal; }
    .meta td { border:1px solid #f37a20; }
    .lbl { background:#f37a20; color:#fff; font-weight:600; width:18%; }
    .val { background:#fff7f2; color:#23313f; }
    h2 { font-size:13px; font-weight:700; margin:14px 0 6px; color:#111; }
    .occ th { background:#f37a20; color:#fff; border:1px solid #111; font-weight:600; text-align:left; }
    .occ td { border:1px solid #111; background:#fff; }
    .ads th { background:#f37a20; color:#fff; border:1px solid #f37a20; font-weight:600; text-align:left; }
    .ads td { border:1px solid #f37a20; background:#fff; vertical-align:top; }
    .ads .item { width:42%; }
    .summary-box { border:1px solid #f37a20; min-height:64px; padding:8px; margin-top:2px; white-space:pre-wrap; }
    .footer-banner { margin-top:22px; }
  </style>
</head>
<body>
  ${header ? `<img class="banner" src="${header}" alt="Weekly Property Report">` : ""}
  <table class="meta">
    <tr>
      <td class="lbl">Property</td><td class="val">${cell(d.property_name)}</td>
      <td class="lbl">Landlord</td><td class="val">${cell(d.landlord_name)}</td>
    </tr>
    <tr>
      <td class="lbl">Reporting Week</td><td class="val">${cell(d.report_week_range)}</td>
      <td class="lbl">Report Date</td><td class="val">${cell(d.report_date)}</td>
    </tr>
    <tr>
      <td class="lbl">Prepared By</td><td class="val">${cell(d.prepared_by)}</td>
      <td class="lbl">Report Type</td><td class="val">${cell(d.report_type)}</td>
    </tr>
  </table>
  <h2>1. Occupancy Status</h2>
  <table class="occ">
    <tr><th>Items</th><th>Details</th><th>Items</th><th>Details</th></tr>
    <tr>
      <td>Total Rooms</td><td>${cell(d.total_rooms)}</td>
      <td>Vacant Room(s)</td><td>${cell(d.vacant_room_status)}</td>
    </tr>
  </table>
  <h2>2. Advertising and Tenant Enquiries</h2>
  <table class="ads">
    <tr><th>Item</th><th>Details</th></tr>
    <tr><td class="item">Vacant Room Advertised?</td><td>${cell(d.vacant_advertised)}</td></tr>
    <tr><td class="item">Advertising Platform</td><td>${cell(d.leasing_narrative || d.advertising_platform)}</td></tr>
    <tr><td class="item">Enquiries Received</td><td>${cell(d.enquiries_received)}</td></tr>
    <tr><td class="item">Suitable Enquiries</td><td>${cell(d.suitable_enquiries)}</td></tr>
    <tr><td class="item">Inspections Arranged</td><td>${cell(d.inspections_arranged)}</td></tr>
  </table>
  <h2>5. Final Summary</h2>
  <div class="summary-box">${cell(d.final_summary)}</div>
  ${footer ? `<img class="footer-banner" src="${footer}" alt="">` : ""}
</body>
</html>`;
}
