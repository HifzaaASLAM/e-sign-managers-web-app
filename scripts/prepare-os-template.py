import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(r"C:\Users\Os\Downloads\esign-saas-phase11-3-ownership-remove-total-fees-field")
SRC = Path(r"C:\Users\Os\Downloads\52_102-May 26 Ownership Statement (1).docx")
OUT = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"

REPLACEMENTS = [
    ("OWNERSHIP STATEMENT#12- J.E.T.S SOLUTIONS", "{statement_heading}"),
    ("01/05/2026 – 31/05/2026", "{statement_period}"),
    ("01/05/2026 - 31/05/2026", "{statement_period}"),
    ("OWNERSHIP ID:                              52/102", "OWNERSHIP ID:                              {ownership_id}"),
    ("OPENING BALANCE:                        $0", "OPENING BALANCE:                        {opening_balance}"),
    ("CLOSING BALANCE:                        $0", "CLOSING BALANCE:                        {closing_balance}"),
    ("OWNERSHIP PAYMENT:            $15192.55", "OWNERSHIP PAYMENT:            {ownership_payment}"),
    ("Name: Jan Remzi", "Name: {owner_name}"),
    ("Company Name: J.E.T.S Solutions Pty Ltd", "Company Name: {company_name}"),
    ("Address: 12 Cremin Court, Rowville Vic 3178", "Address: {owner_address}"),
    ("Phone: 0448768178", "Phone: {owner_phone}"),
    ("Email: rental102@yahoo.com", "Email: {owner_email}"),
    ("Share House Management Fee May2026", "{fee_label}"),
    ("SUBTOTAL                $1902.45          $0.00", "SUBTOTAL                {fee_money_out}          $0.00"),
    ("Total Fees paid in period                                                  TOTAL                -$1902.45", "Total Fees paid in period                                                  TOTAL                {fee_total}"),
    ("SUBTOTAL            $568.52", "SUBTOTAL            {summary_maintenance}"),
    ("TOTAL PAID TO LANDLORD OR               TOTAL                   $568.52", "TOTAL PAID TO LANDLORD OR               TOTAL                   {summary_maintenance}"),
    ("SUBTOTAL            $15192.55", "SUBTOTAL            {summary_paid_to_owner}"),
    ("TOTAL PAID TO LANDLORD OR               TOTAL                   $15192.55", "TOTAL PAID TO LANDLORD OR               TOTAL                   {summary_paid_to_owner}"),
    ("Rental Payments", "Rental Payments"),
    ("$17295", "{total_rent}"),
    ("Management Fees (inc. GST)", "Management Fees (inc. GST)"),
    ("$1902.45", "{summary_management_fees}"),
    ("Property Maintenance (Elec. Bills)", "Property Maintenance"),
    ("$200", "{summary_maintenance}"),
    ("Paid To owner", "Paid To owner"),
    ("$15192.55", "{summary_paid_to_owner}"),
    ("SUBTOTAL   $17295                         $17295", "SUBTOTAL   {total_rent}                         {total_rent}"),
    ("Total ownership payments                        TOTAL                                        $15192.55", "Total ownership payments                        TOTAL                                        {summary_paid_to_owner}"),
    ("Total Paid to owner                                     TOTAL        -$15192.55", "Total Paid to owner                                     TOTAL        -{summary_paid_to_owner}"),
    ("CLOSING (CARRIED FORWARD) BALANCE                                               $0", "CLOSING (CARRIED FORWARD) BALANCE                                               {closing_balance}"),
    ("Generated on 30/05/2026", "Generated on {generated_on}"),
    ("May26. Rent Payment - 01/05/26 To 31/05/26", "{ownership_payment_description}"),
    ("30/05/26", "{ownership_payment_date}"),
    ("$172.9", "{fee_gst}"),
    ("$1729.5", "{fee_money_out}"),
]

RENT_MARKERS = ("{#rent_rows}", "{/rent_rows}")
MAINT_MARKERS = ("{#maintenance_rows}", "{/maintenance_rows}")


def extract_rows(xml: str, start_marker: str, end_marker: str):
    start = xml.find(start_marker)
    end = xml.find(end_marker)
    if start == -1 or end == -1:
        return xml, None
    row_start = xml.rfind("<w:tr", 0, start)
    row_end = xml.find("</w:tr>", end) + len("</w:tr>")
    if row_start == -1 or row_end <= row_start:
        return xml, None
    return xml, (row_start, row_end, xml[row_start:row_end])


def remove_rows_containing(xml: str, needle: str, keep_row: str | None):
    pattern = re.compile(r"<w:tr\b[\s\S]*?</w:tr>")
    for match in list(pattern.finditer(xml)):
        row = match.group(0)
        if needle in row and row != keep_row:
            xml = xml.replace(row, "", 1)
    return xml


def main():
    temp = ROOT / "scripts" / ".os-template-work"
    if temp.exists():
        shutil.rmtree(temp)
    temp.mkdir(parents=True)

    with zipfile.ZipFile(SRC, "r") as zin:
        zin.extractall(temp)

    doc_path = temp / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")

    for old, new in REPLACEMENTS:
        xml = xml.replace(old, new)

    if "R1/52 Glengarry Ave Burwood" in xml:
        xml = xml.replace("R1/52 Glengarry Ave Burwood", "{#rent_rows}{rent_property}", 1)
        xml = xml.replace("Eeshan", "{rent_tenancy}", 1)
        xml = xml.replace("$260/week", "{rent_amount}", 1)
        xml = xml.replace("13/05/26 To 09/06/26", "{rent_period}", 1)
        xml = xml.replace(">$1040<", ">{rent_total}{/rent_rows}<", 1)

    if "Gardening at 102 North Road" in xml:
        xml = xml.replace("001", "{#maintenance_rows}{maintenance_inv}", 1)
        xml = xml.replace("Gardening at 102 North Road", "{maintenance_description}", 1)
        xml = xml.replace(">$200<", ">{maintenance_total}{/maintenance_rows}<", 1)

    xml, rent_row = extract_rows(xml, *RENT_MARKERS)
    if rent_row:
        _, _, rent_template = rent_row
        xml = remove_rows_containing(xml, "Glengarry Ave Burwood", rent_template)
        xml = remove_rows_containing(xml, "North Rd, Newport", rent_template)

    xml, maint_row = extract_rows(xml, *MAINT_MARKERS)
    if maint_row:
        _, _, maint_template = maint_row
        xml = remove_rows_containing(xml, "Electricity Bill", maint_template)

    doc_path.write_text(xml, encoding="utf-8")

    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for file in sorted(temp.rglob("*")):
            if file.is_file():
                zout.write(file, file.relative_to(temp).as_posix())

    public_out = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"
    public_out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT, public_out)
    print("Wrote", OUT)

    import subprocess
    import sys

    subprocess.run([sys.executable, str(ROOT / "scripts" / "build-os-template.py")], check=True)


if __name__ == "__main__":
    main()
