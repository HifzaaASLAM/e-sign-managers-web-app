function str(value: unknown) {
  return String(value ?? "").trim();
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const normalized = str(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeYesNo(value: unknown) {
  const normalized = str(value).toLowerCase();
  if (!normalized) return "";
  if (["yes", "y", "true", "1"].includes(normalized)) return "Yes";
  if (["no", "n", "false", "0"].includes(normalized)) return "No";
  return str(value);
}

function normalizeDate(value: unknown) {
  const raw = str(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

export type LandlordWeeklyReportSheetInput = Record<string, unknown>;

export function mapSheetRowToWeeklyReportData(input: LandlordWeeklyReportSheetInput) {
  const row = (input.row && typeof input.row === "object" ? input.row : input) as Record<string, unknown>;
  const landlordName = firstNonEmpty(row.landlord_name, row.landlord, row.owner_name, row["Landlord Name"]);
  const landlordEmail = firstNonEmpty(row.landlord_email, row.owner_email, row.email, row["Landlord Email"]);
  const reportDate = firstNonEmpty(row.report_date, row.generated_on, new Date().toISOString().slice(0, 10));

  return {
    row_id: firstNonEmpty(row.row_id, row.rowId, row.id, row["Row ID"]),
    property_name: firstNonEmpty(row.property_name, row.property, row.property_reference, row["Property"]),
    landlord_name: landlordName,
    landlord_email: landlordEmail,
    report_week_start: normalizeDate(firstNonEmpty(row.report_week_start, row.week_start, row["Week Start"])),
    report_week_end: normalizeDate(firstNonEmpty(row.report_week_end, row.week_end, row["Week End"])),
    report_date: normalizeDate(reportDate),
    total_rooms: firstNonEmpty(row.total_rooms, row["Total Rooms"]),
    occupied_rooms: firstNonEmpty(row.occupied_rooms, row["Occupied Rooms"]),
    vacant_rooms: firstNonEmpty(row.vacant_rooms, row["Vacant Rooms"]),
    upcoming_vacancies: firstNonEmpty(row.upcoming_vacancies, row["Upcoming Vacancies"]),
    move_ins_this_week: firstNonEmpty(row.move_ins_this_week, row["Move-ins This Week"]),
    moving_out: firstNonEmpty(row.moving_out, row["Who Is Moving Out?"]),
    vacant_advertised: firstNonEmpty(normalizeYesNo(row.vacant_advertised), row["Vacant Room Advertised?"]),
    advertising_platform: firstNonEmpty(row.advertising_platform, row["Advertising Platform"]),
    enquiries_received: firstNonEmpty(row.enquiries_received, row["Enquiries Received"]),
    suitable_enquiries: firstNonEmpty(row.suitable_enquiries, row["Suitable Enquiries"]),
    inspections_arranged: firstNonEmpty(row.inspections_arranged, row["Inspections Arranged"]),
    applications_received: firstNonEmpty(row.applications_received, row["Application / Lease Forms Received"]),
    rent_received_week: firstNonEmpty(row.rent_received_week, row["Rent Received This Week"]),
    new_maintenance_requests: firstNonEmpty(row.new_maintenance_requests, row["New Maintenance Requests"]),
    urgency_level: firstNonEmpty(row.urgency_level, row["Urgency Level"]),
    contractor_contacted: firstNonEmpty(row.contractor_contacted, row["Contractor Contacted"]),
    quoted: firstNonEmpty(row.quoted, row.quote_value, row["Quoted?"]),
    landlord_approved: firstNonEmpty(row.landlord_approved, row["Landlord Approved?"]),
    completed_repairs: firstNonEmpty(row.completed_repairs, row["Completed Repairs"]),
    final_summary: firstNonEmpty(row.final_summary, row.summary, row["Final Summary"]),
  };
}
