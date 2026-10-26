"""Move maintenance loop date placeholder from INV# column to Date column."""
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx",
    ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx",
]


def fix_maintenance_columns(xml: str) -> str:
    # Current: INV# cell has loop start + maintenance_inv; Date cell is empty.
    xml = xml.replace(
        "{#maintenance_rows}{maintenance_inv}",
        "{maintenance_inv}",
        1,
    )
    xml = xml.replace(
        "{#maintenance_rows}{maintenance_date}",
        "{maintenance_date}",
        1,
    )

    i = xml.find("{#maintenance_rows}")
    if i == -1:
        i = xml.find("{maintenance_inv}")
    if i == -1:
        return xml

    row_start = xml.rfind("<w:tr", 0, i)
    row_end = xml.find("</w:tr>", i) + len("</w:tr>")
    row = xml[row_start:row_end]
    cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
    if len(cells) < 2:
        return xml

    date_cell = cells[0]
    if "{maintenance_date}" not in date_cell and "{#maintenance_rows}" not in date_cell:
        if re.search(r"<w:t[^>]*>\s*</w:t>", date_cell):
            date_cell = re.sub(
                r"(<w:t[^>]*>)\s*(</w:t>)",
                r"\1{#maintenance_rows}{maintenance_date}\2",
                date_cell,
                count=1,
            )
        else:
            date_cell = date_cell.replace(
                "</w:tc>",
                "<w:p><w:r><w:t>{#maintenance_rows}{maintenance_date}</w:t></w:r></w:p></w:tc>",
                1,
            )
        row = row.replace(cells[0], date_cell, 1)

    xml = xml[:row_start] + row + xml[row_end:]
    return xml


def fix_docx(path: Path) -> None:
    td = Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(path, "r") as zin:
            zin.extractall(td)
        doc = td / "word" / "document.xml"
        xml = doc.read_text(encoding="utf-8")
        xml = fix_maintenance_columns(xml)
        doc.write_text(xml, encoding="utf-8")
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
            for f in sorted(td.rglob("*")):
                if f.is_file():
                    zout.write(f, f.relative_to(td).as_posix())
    finally:
        shutil.rmtree(td)


def main():
    for path in PATHS:
        if not path.exists():
            print(f"skip missing: {path}")
            continue
        fix_docx(path)
        print(f"fixed: {path.name}")


if __name__ == "__main__":
    main()
