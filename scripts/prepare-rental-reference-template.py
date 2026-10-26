"""Inject [[PLACEHOLDER]] tokens into the Rental Reference Form DOCX template."""
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "shm-plugin-assets" / "templates" / "rental-reference-form-source.docx"
OUT = ROOT / "lib" / "shm" / "templates" / "rental-reference-form-template.docx"
PUBLIC_OUT = ROOT / "public" / "shm-plugin-assets" / "templates" / "rental-reference-form-template.docx"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}

# Question labels shown in the Word template (same order as the signing form).
RENTAL_ITEMS = [
    "1. You are completing a rental reference for this tenant/property",
    "2. Please confirm you have been the Property Manager for this tenant at this property",
    "Is the tenant currently renting with you?",
    "3a. Have you received a notice to vacate?",
    "4. Confirm the length of the tenancy agreement",
    "5. Does the tenant make rent payments on time?",
    "6. Were any notices for rent issued?",
    "7. Was the property in good condition upon routine inspections?",
    "Have you issued notices after routine inspections?",
    "Did you make a bond claim at the end of their tenancy? (if applicable)",
    "Would you be happy to recommend this tenant?",
    "Please upload the tenant's rental ledger (PDF, CSV, JPG, or PNG)",
    "I would like to provide my own questionnaire and answers for this reference.",
]

# Row indexes in the source table that hold Yes/No checklist items.
ITEM_ROWS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20]


def merge_runs(xml: str) -> str:
    pattern = re.compile(
        r"</w:t></w:r><w:r[^>]*>(?:<w:rPr>(?:[^<]|<(?!/?w:rPr>))*</w:rPr>)?<w:t[^>]*>"
    )
    prev = ""
    next_xml = xml.replace("<w:tab/>", "\t")
    while next_xml != prev:
        prev = next_xml
        next_xml = pattern.sub("", next_xml)
    return next_xml


def set_cell_text(cell, text: str):
    for child in list(cell):
        cell.remove(child)
    paragraph = ET.SubElement(cell, f"{{{W_NS}}}p")
    run = ET.SubElement(paragraph, f"{{{W_NS}}}r")
    node = ET.SubElement(run, f"{{{W_NS}}}t")
    node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    node.text = text


def clear_cell(cell):
    set_cell_text(cell, "")


def inject_placeholders(xml: str) -> str:
    root = ET.fromstring(xml)
    rows = root.findall(".//w:tr", NS)

    if len(rows) > 1:
        cells = rows[1].findall("w:tc", NS)
        if cells:
            set_cell_text(cells[0], "RENTAL REFERENCE")

    # Clear leftover PM-takeover-style rows that are not part of this form.
    for row_idx in range(4, min(39, len(rows))):
        cells = rows[row_idx].findall("w:tc", NS)
        for cell in cells:
            clear_cell(cell)

    for item_idx, row_idx in enumerate(ITEM_ROWS):
        if item_idx >= len(RENTAL_ITEMS) or row_idx >= len(rows):
            continue
        cells = rows[row_idx].findall("w:tc", NS)
        if len(cells) < 3:
            continue
        set_cell_text(cells[0], RENTAL_ITEMS[item_idx])
        set_cell_text(cells[1], f"[[ITEM_{item_idx}_YES]]")
        set_cell_text(cells[2], f"[[ITEM_{item_idx}_NO]]")

    if len(rows) > 39:
        cells = rows[39].findall("w:tc", NS)
        if cells:
            set_cell_text(cells[0], "Any other items / notes: [[OTHER_ITEMS]]")

    if len(rows) > 40:
        cells = rows[40].findall("w:tc", NS)
        if cells:
            set_cell_text(cells[0], "Signer name: [[SIGNER_NAME]]     Date: [[SIGN_DATE]]")

    if len(rows) > 41:
        cells = rows[41].findall("w:tc", NS)
        if cells:
            set_cell_text(cells[0], "Signature: [[SIGNATURE]]")

    return ET.tostring(root, encoding="unicode")


def main():
    if not SRC.exists():
        raise SystemExit(f"Missing source template: {SRC}")

    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = merge_runs(files["word/document.xml"].decode("utf-8"))
    xml = inject_placeholders(xml)
    files["word/document.xml"] = xml.encode("utf-8")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    print("Wrote", OUT)
    print("Item count:", len(RENTAL_ITEMS))

    PUBLIC_OUT.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(OUT, PUBLIC_OUT)
        print("Wrote", PUBLIC_OUT)
    except PermissionError:
        print("Skipped public copy (file in use). Prepared template is at", OUT)


if __name__ == "__main__":
    main()
