"""Remove leftover sample values from the ownership statement Word template."""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"


def extract_rows(xml: str, start: int, end: int):
  return re.findall(r"<w:tr\b[\s\S]*?</w:tr>", xml[start:end])


def main():
  work = ROOT / "scripts" / ".os-template-fix-work"
  if work.exists():
    shutil.rmtree(work)
  work.mkdir(parents=True)

  with zipfile.ZipFile(TEMPLATE, "r") as zin:
    zin.extractall(work)

  doc_path = work / "word" / "document.xml"
  xml = doc_path.read_text(encoding="utf-8")

  maint_start = xml.find("PROPERTY MAINTENANCE")
  maint_end = xml.find("OWNERSHIP PAYMENTS", maint_start)
  maint_rows = extract_rows(xml, maint_start, maint_end)
  maint_data_row = next(
    (r for r in maint_rows if "{#maintenance_rows}" in r or "001" in r or "{maintenance_description}" in r),
    "",
  )
  if not maint_data_row:
    raise RuntimeError("Maintenance template row was not found.")

  if "{maintenance_total}" not in maint_data_row:
    new_maint_row = (
      maint_data_row.replace("001", "{#maintenance_rows}{maintenance_inv}", 1)
      .replace("<w:t xml:space=\"preserve\">200</w:t>", "<w:t xml:space=\"preserve\">{maintenance_total}{/maintenance_rows}</w:t>", 1)
    )
    xml = xml.replace(maint_data_row, new_maint_row, 1)

  maint_hardcoded_row = next((r for r in maint_rows if "Electricity Bill" in r), "")
  maint_subtotal_row = next(r for r in maint_rows if "SUBTOTAL" in r)
  maint_total_row = next(r for r in maint_rows if "TOTAL PAID TO LANDLORD OR" in r)
  if maint_hardcoded_row:
    xml = xml.replace(maint_hardcoded_row, "", 1)
  if "568.52" in maint_subtotal_row:
    xml = xml.replace(maint_subtotal_row, maint_subtotal_row.replace("568.52", "{summary_maintenance}"), 1)
  if "568.52" in maint_total_row:
    xml = xml.replace(maint_total_row, maint_total_row.replace("568.52", "{summary_maintenance}"), 1)

  own_start = xml.find("OWNERSHIP PAYMENTS")
  own_end = xml.find("PROPERTY INCOME", own_start)
  own_rows = extract_rows(xml, own_start, own_end)
  own_data_row = next(r for r in own_rows if "{ownership_payment_date}" in r)
  own_subtotal_row = next(r for r in own_rows if "SUBTOTAL" in r)
  own_total_row = next(r for r in own_rows if "TOTAL PAID TO LANDLORD OR" in r)

  if "$2102.45" in own_data_row or "{total_fees_maintenance}" not in own_data_row:
    new_own_row = own_data_row.replace("$2102.45", "{total_fees_maintenance}", 1)
    if "{ownership_payment_ref}" not in new_own_row:
      new_own_row = new_own_row.replace(
        "{ownership_payment_description} ",
        "{ownership_payment_ref} {ownership_payment_description}",
        1,
      )
    if "{summary_rental_payments}" not in new_own_row:
      new_own_row = new_own_row.replace("{total_rent}", "{summary_rental_payments}", 1)
    xml = xml.replace(own_data_row, new_own_row, 1)
  if "15192.55" in own_subtotal_row:
    xml = xml.replace(own_subtotal_row, own_subtotal_row.replace("15192.55", "{summary_paid_to_owner}"), 1)
  if "15192.55" in own_total_row:
    xml = xml.replace(own_total_row, own_total_row.replace("15192.55", "{summary_paid_to_owner}"), 1)

  doc_path.write_text(xml, encoding="utf-8")

  if TEMPLATE.exists():
    TEMPLATE.unlink()
  with zipfile.ZipFile(TEMPLATE, "w", zipfile.ZIP_DEFLATED) as zout:
    for file in sorted(work.rglob("*")):
      if file.is_file():
        zout.write(file, file.relative_to(work).as_posix())

  PUBLIC.parent.mkdir(parents=True, exist_ok=True)
  shutil.copy2(TEMPLATE, PUBLIC)
  shutil.rmtree(work)
  print("Fixed template:", TEMPLATE)


if __name__ == "__main__":
  main()
