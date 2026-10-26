"""Inject [[PLACEHOLDER]] tokens into the PM Takeover Form DOCX template."""
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "shm-plugin-assets" / "templates" / "pm-takeover-form-source.docx"
OUT = ROOT / "lib" / "shm" / "templates" / "pm-takeover-form-template.docx"
PUBLIC_OUT = ROOT / "public" / "shm-plugin-assets" / "templates" / "pm-takeover-form-template.docx"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}

ITEM_ROWS = [
    4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    30, 31, 32, 33,
    35, 36,
    38,
]


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


def inject_placeholders(xml: str) -> str:
    root = ET.fromstring(xml)
    rows = root.findall(".//w:tr", NS)

    for item_idx, row_idx in enumerate(ITEM_ROWS):
        if row_idx >= len(rows):
            continue
        cells = rows[row_idx].findall("w:tc", NS)
        if len(cells) < 3:
            continue
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

    PUBLIC_OUT.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(OUT, PUBLIC_OUT)
        print("Wrote", PUBLIC_OUT)
    except PermissionError:
        print("Skipped public copy (file in use). Prepared template is at", OUT)


if __name__ == "__main__":
    main()
