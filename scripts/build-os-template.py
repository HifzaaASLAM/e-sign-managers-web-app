"""
Build ownership-statement-template.docx from the original sample document.
Preserves layout/colors and maps creator form fields to docxtemplater placeholders.
"""

import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\Os\Downloads\52_102-May 26 Ownership Statement (1).docx")
OUT = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"

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

DOLLAR_REPLACEMENTS = [
    ("$17295                         $17295", "{summary_rental_payments}                         {summary_rental_payments}"),
    ("$1902.45          $0.00", "{summary_management_fees}          $0.00"),
    ("$1902{summary_management_fees}", "{summary_management_fees}"),
    ("-$1902.45", "{fee_total}"),
    ("$2102.45", "{total_fees_maintenance}"),
    ("$17295", "{summary_rental_payments}"),
    ("$15192.55", "{summary_paid_to_owner}"),
    ("$568.52", "{summary_maintenance}"),
    ("$200", "{summary_maintenance}"),
]


def run_text(run_xml: str) -> str:
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run_xml))


def strip_lone_dollars(xml: str) -> tuple[str, int]:
    """Remove template $ before placeholders that export already formats with $."""
    strip_before = (
        "summary_maintenance",
        "summary_paid_to_owner",
        "total_fees_maintenance",
        "summary_rental_payments",
        "summary_management_fees",
        "summary_paid_to_owner_negative",
        "closing_balance",
        "ownership_payment",
        "fee_total",
        "fee_gst",
        "fee_money_out",
        "total_rent",
        "opening_balance",
    )
    run_re = re.compile(r"<w:r\b[\s\S]*?</w:r>")
    runs = list(run_re.finditer(xml))
    remove_spans: list[tuple[int, int]] = []

    for i, match in enumerate(runs):
        if run_text(match.group(0)) != "$":
            continue
        if i + 1 >= len(runs):
            continue
        nxt = run_text(runs[i + 1].group(0))
        if not nxt.startswith("{"):
            continue
        if not any(tag in nxt for tag in strip_before):
            continue
        remove_spans.append(match.span())

    for start, end in reversed(remove_spans):
        xml = xml[:start] + xml[end:]

    return xml, len(remove_spans)


def extract_row(xml: str, start_marker: str, end_marker: str):
    start = xml.find(start_marker)
    end = xml.find(end_marker)
    if start == -1 or end == -1:
        return None
    row_start = xml.rfind("<w:tr", 0, start)
    row_end = xml.find("</w:tr>", end) + len("</w:tr>")
    if row_start == -1 or row_end <= row_start:
        return None
    return row_start, row_end, xml[row_start:row_end]


def remove_rows_containing(xml: str, needle: str, keep_row: str | None = None):
    pattern = re.compile(r"<w:tr\b[\s\S]*?</w:tr>")
    for match in list(pattern.finditer(xml)):
        row = match.group(0)
        if needle in row and row != keep_row:
            xml = xml.replace(row, "", 1)
    return xml


def main():
    if not SRC.exists():
        raise SystemExit(f"Original template not found: {SRC}")

    temp = ROOT / "scripts" / ".os-template-build-work"
    if temp.exists():
        shutil.rmtree(temp)
    temp.mkdir(parents=True)

    with zipfile.ZipFile(SRC, "r") as zin:
        zin.extractall(temp)

    doc_path = temp / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")

    for old, new in STATIC_REPLACEMENTS:
        xml = xml.replace(old, new)

    # Rent loop — 5 cells like original
    if "R1/52 Glengarry Ave Burwood" in xml:
        xml = xml.replace("R1/52 Glengarry Ave Burwood", "{#rent_rows}{rent_property}", 1)
        xml = xml.replace("Eeshan", "{rent_tenancy}", 1)
        xml = xml.replace("$260/week", "{rent_amount}", 1)
        xml = xml.replace("13/05/26 To 09/06/26", "{rent_period}", 1)
        xml = xml.replace(">$1040<", ">{rent_total}{/rent_rows}<", 1)

    rent_row = extract_row(xml, "{#rent_rows}", "{/rent_rows}")
    if rent_row:
        _, _, rent_template = rent_row
        xml = remove_rows_containing(xml, "Glengarry Ave Burwood", rent_template)
        xml = remove_rows_containing(xml, "North Rd, Newport", rent_template)

    # Maintenance loop — date in Date column, inv# in INV# column
    if "Gardening at 102 North Road" in xml:
        xml = xml.replace('<w:t xml:space="preserve">001</w:t>', '<w:t xml:space="preserve">{maintenance_inv}</w:t>', 1)
        xml = xml.replace("Gardening at 102 North Road", "{maintenance_description}", 1)
        xml = xml.replace('<w:t xml:space="preserve">200</w:t>', '<w:t xml:space="preserve">{maintenance_total}{/maintenance_rows}</w:t>', 1)
        # Put loop start in the empty Date cell (first cell of maintenance data row).
        maint_data = extract_row(xml, "{maintenance_inv}", "{/maintenance_rows}")
        if maint_data:
            row_start, row_end, row = maint_data
            cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
            if cells and "{#maintenance_rows}" not in row:
                date_cell = cells[0]
                if "{maintenance_date}" not in date_cell:
                    date_cell = re.sub(
                        r"(<w:t[^>]*>)\s*(</w:t>)",
                        r"\1{#maintenance_rows}{maintenance_date}\2",
                        date_cell,
                        count=1,
                    )
                    row = row.replace(cells[0], date_cell, 1)
                    xml = xml[:row_start] + row + xml[row_end:]

    maint_start = xml.find("PROPERTY MAINTENANCE")
    if maint_start >= 0:
        maint_end = xml.find("OWNERSHIP PAYMENTS", maint_start)
        section = xml[maint_start:maint_end]
        pattern = re.compile(r"<w:tr\b[\s\S]*?</w:tr>")
        for match in list(pattern.finditer(section)):
            row = match.group(0)
            if "Electricity Bill" in row and "{#maintenance_rows}" not in row:
                section = section.replace(row, "", 1)
        xml = xml[:maint_start] + section + xml[maint_end:]

    for old, new in DOLLAR_REPLACEMENTS:
        xml = xml.replace(old, new)

    xml, _ = strip_lone_dollars(xml)

    xml = xml.replace(
        ">{ownership_payment_description} <",
        ">{ownership_payment_ref} {ownership_payment_description}<",
        1,
    )

    doc_path.write_text(xml, encoding="utf-8")

    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for file in sorted(temp.rglob("*")):
            if file.is_file():
                zout.write(file, file.relative_to(temp).as_posix())

    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OUT, PUBLIC)

    img_out = ROOT / "public" / "shm-plugin-assets" / "images"
    img_out.mkdir(parents=True, exist_ok=True)
    media = temp / "word" / "media" / "image1.png"
    if media.exists():
        shutil.copy2(media, img_out / "ownership-statement-header.png")
        shutil.copy2(media, ROOT / "lib" / "shm" / "templates" / "ownership-statement-header.png")

    shutil.rmtree(temp)
    print("Built template:", OUT)


if __name__ == "__main__":
    main()
