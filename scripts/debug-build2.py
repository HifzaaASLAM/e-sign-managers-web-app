import re
import shutil
import zipfile
from pathlib import Path

SRC = Path(r"C:\Users\Os\Downloads\52_102-May 26 Ownership Statement (1).docx")
ROOT = Path(__file__).resolve().parents[1]
temp = ROOT / "scripts" / ".debug-build2"
shutil.rmtree(temp, ignore_errors=True)
temp.mkdir()
with zipfile.ZipFile(SRC) as z:
    z.extractall(temp)
xml = (temp / "word" / "document.xml").read_text(encoding="utf-8")

STATIC_REPLACEMENTS = [
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
    ("$172.9", "{fee_gst}"),
    ("$1729.5", "{fee_money_out}"),
    ("May26. Rent Payment - 01/05/26 To 31/05/26", "{ownership_payment_description}"),
    ("30/05/26", "{ownership_payment_date}"),
    ("Generated on 30/05/2026", "Generated on {generated_on}"),
    ("Property Maintenance (Elec. Bills)", "Property Maintenance"),
    ("Total ownership payments                        TOTAL                                        $15192.55", "Total ownership payments                        TOTAL                                        {summary_paid_to_owner}"),
    ("Total Paid to owner                                     TOTAL        -$15192.55", "Total Paid to owner                                     TOTAL        {summary_paid_to_owner_negative}"),
    ("CLOSING (CARRIED FORWARD) BALANCE                                               $0", "CLOSING (CARRIED FORWARD) BALANCE                                               {closing_balance}"),
]

def show(label):
    for r in re.findall(r"<w:tr\b[\s\S]*?</w:tr>", xml):
        if "{ownership_payment_date}" in r:
            print(label, [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r) if t.strip()])

for old, new in STATIC_REPLACEMENTS:
    xml = xml.replace(old, new)
show("after static")

if "R1/52 Glengarry Ave Burwood" in xml:
    xml = xml.replace("R1/52 Glengarry Ave Burwood", "{#rent_rows}{rent_property}", 1)
    xml = xml.replace("Eeshan", "{rent_tenancy}", 1)
    xml = xml.replace("$260/week", "{rent_amount}", 1)
    xml = xml.replace("13/05/26 To 09/06/26", "{rent_period}", 1)
    xml = xml.replace(">$1040<", ">{rent_total}{/rent_rows}<", 1)
show("after rent markers")

def extract_row(xml, start_marker, end_marker):
    start = xml.find(start_marker)
    end = xml.find(end_marker)
    if start == -1 or end == -1:
        return None
    row_start = xml.rfind("<w:tr", 0, start)
    row_end = xml.find("</w:tr>", end) + len("</w:tr>")
    return row_start, row_end, xml[row_start:row_end]

def remove_rows_containing(xml, needle, keep_row=None):
    pattern = re.compile(r"<w:tr\b[\s\S]*?</w:tr>")
    for match in list(pattern.finditer(xml)):
        row = match.group(0)
        if needle in row and row != keep_row:
            xml = xml.replace(row, "", 1)
    return xml

rent_row = extract_row(xml, "{#rent_rows}", "{/rent_rows}")
if rent_row:
    _, _, rent_template = rent_row
    xml = remove_rows_containing(xml, "Glengarry Ave Burwood", rent_template)
    xml = remove_rows_containing(xml, "North Rd, Newport", rent_template)
show("after rent cleanup")

if "Gardening at 102 North Road" in xml:
    xml = xml.replace("001", "{#maintenance_rows}{maintenance_inv}", 1)
    xml = xml.replace("Gardening at 102 North Road", "{maintenance_description}", 1)
    xml = xml.replace('<w:t xml:space="preserve">200</w:t>', '<w:t xml:space="preserve">{maintenance_total}{/maintenance_rows}</w:t>', 1)
show("after maint markers")

maint_row = extract_row(xml, "{#maintenance_rows}", "{/maintenance_rows}")
if maint_row:
    _, _, maint_template = maint_row
    xml = remove_rows_containing(xml, "Electricity Bill", maint_template)
show("after maint cleanup")

DOLLAR_REPLACEMENTS = [
    ("$17295                         $17295", "{summary_rental_payments}                         {summary_rental_payments}"),
    ("$1902.45          $0.00", "{summary_management_fees}          $0.00"),
    ("-$1902.45", "{fee_total}"),
    ("$2102.45", "{total_fees_maintenance}"),
    ("$17295", "{summary_rental_payments}"),
    ("$15192.55", "{summary_paid_to_owner}"),
    ("$568.52", "{summary_maintenance}"),
    ("$200", "{summary_maintenance}"),
]
for old, new in DOLLAR_REPLACEMENTS:
    xml = xml.replace(old, new)
show("after dollars")

def strip_dollar_before_placeholders(xml):
    return re.sub(
        r"(<w:t[^>]*>)\$(</w:t>\s*</w:r>\s*(?:<w:r[^>]*>\s*<w:rPr>[\s\S]*?</w:rPr>\s*)?<w:t[^>]*>)(\{[^{}]+\})",
        r"\1\3",
        xml,
    )

xml = strip_dollar_before_placeholders(xml)
show("after strip")

xml = xml.replace(
    ">{ownership_payment_description} <",
    ">{ownership_payment_ref} {ownership_payment_description}<",
    1,
)
show("after ref merge")
