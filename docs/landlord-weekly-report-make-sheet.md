# Landlord Weekly Report (Google Sheets + Make + App)

## Make Scenario

1. **Trigger:** Google Sheets `Watch Rows`
2. **Filter:** `tag` equals `Ready`
3. **Webhook request:** `POST /api/shm-docs/landlord-weekly-report/make-webhook`
   - Header: `x-make-secret: <LANDLORD_WEEKLY_REPORT_MAKE_SECRET>` (if enabled)
4. **Email module:** Send to webhook response `landlord.email`
   - Attach `pdf.fileContentBase64` when available
   - Fallback to `docx.fileContentBase64` if PDF is null
5. **Update row:** set `tag = Sent` and store `report_id`

## Recommended Google Sheet Columns

- `tag`
- `row_id` (optional, but useful for idempotency in Make)
- `property_name`
- `landlord_name`
- `landlord_email`
- `report_week_start`
- `report_week_end`
- `report_date`
- `total_rooms`
- `occupied_rooms`
- `vacant_rooms`
- `upcoming_vacancies`
- `move_ins_this_week`
- `moving_out`
- `vacant_advertised`
- `advertising_platform`
- `enquiries_received`
- `suitable_enquiries`
- `inspections_arranged`
- `applications_received`
- `rent_received_week`
- `new_maintenance_requests`
- `urgency_level`
- `contractor_contacted`
- `quoted`
- `landlord_approved`
- `completed_repairs`
- `final_summary`
- `last_report_id` (written by Make)
- `last_sent_at` (written by Make)
- `error_message` (written by Make on failure)

## Notes

- The DOCX template already in the app is:
  - `lib/shm/templates/landlord-weekly-report-template.docx`
- This template matches your provided file:
  - `ShareHouseManagers_Weekly_Landlord_Report_One_Page_Template_Revised (5).docx`
- Webhook accepts either a flat payload or a nested `row` object.
