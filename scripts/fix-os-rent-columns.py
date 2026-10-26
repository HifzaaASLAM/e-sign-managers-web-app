"""Split rent period into Paid From / Paid To columns in the Word template."""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"


def main():
  work = ROOT / "scripts" / ".os-rent-fix-work"
  if work.exists():
    shutil.rmtree(work)
  work.mkdir(parents=True)

  with zipfile.ZipFile(TEMPLATE, "r") as zin:
    zin.extractall(work)

  doc_path = work / "word" / "document.xml"
  xml = doc_path.read_text(encoding="utf-8")

  if "{rent_paid_from}" not in xml and "{rent_period}" in xml:
    xml = xml.replace(
      "<w:t xml:space=\"preserve\">{rent_period}</w:t>",
      "<w:t xml:space=\"preserve\">{rent_paid_from}</w:t>",
      1,
    )
    # Insert Paid To cell before rent_total cell.
    marker = "<w:t xml:space=\"preserve\">{rent_total}{/rent_rows}</w:t>"
    paid_to_cell = (
      "</w:tc><w:tc><w:tcPr/><w:p><w:pPr><w:rPr>"
      "<w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/>"
      "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:pPr>"
      "<w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/>"
      "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr>"
      "<w:t xml:space=\"preserve\">{rent_paid_to}</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><w:pPr><w:rPr>"
      "<w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/>"
      "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:pPr><w:r><w:rPr>"
      "<w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/>"
      "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr>"
    )
    xml = xml.replace(marker, paid_to_cell + marker, 1)

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
  print("Updated rent columns:", TEMPLATE)


if __name__ == "__main__":
  main()
