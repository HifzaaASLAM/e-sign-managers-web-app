"""Add ownership_payment_ref placeholder to the INV# cell in the ownership payments row."""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"


def main():
    work = ROOT / "scripts" / ".os-ownership-ref-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    with zipfile.ZipFile(TEMPLATE, "r") as zin:
        zin.extractall(work)

    doc_path = work / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")

    if "{ownership_payment_ref}" in xml:
        shutil.rmtree(work)
        print("ownership_payment_ref already present")
        return

    own_start = xml.find("OWNERSHIP PAYMENTS")
    own_end = xml.find("PROPERTY INCOME", own_start)
    section = xml[own_start:own_end]
    rows = re.findall(r"<w:tr\b[\s\S]*?</w:tr>", section)

    data_row = next(
        (
            r
            for r in rows
            if "{ownership_payment_date}" in r
            and "SUBTOTAL" not in r
            and "{ownership_payment_description}" in r
        ),
        "",
    )
    if not data_row:
        shutil.rmtree(work)
        print("Ownership payment data row not found")
        return

    cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", data_row)
    if len(cells) < 2:
        shutil.rmtree(work)
        return

    inv_cell = cells[1]
    if re.search(r"<w:t[^>]*>", inv_cell):
        new_inv = re.sub(
            r"<w:t[^>]*>[\s\S]*?</w:t>",
            '<w:t xml:space="preserve">{ownership_payment_ref}</w:t>',
            inv_cell,
            count=1,
        )
    else:
        new_inv = re.sub(
            r"(</w:pPr>\s*)",
            r'\1<w:r><w:t xml:space="preserve">{ownership_payment_ref}</w:t></w:r>',
            inv_cell,
            count=1,
        )

    new_row = data_row.replace(inv_cell, new_inv, 1)
    xml = xml.replace(data_row, new_row, 1)

    doc_path.write_text(xml, encoding="utf-8")

    if TEMPLATE.exists():
        TEMPLATE.unlink()
    with zipfile.ZipFile(TEMPLATE, "w", zipfile.ZIP_DEFLATED) as zout:
        for file in sorted(work.rglob("*")):
            if file.is_file():
                zout.write(file, file.relative_to(work).as_posix())

    shutil.copy2(TEMPLATE, PUBLIC)
    shutil.rmtree(work)
    print("Added ownership_payment_ref cell")


if __name__ == "__main__":
    main()
