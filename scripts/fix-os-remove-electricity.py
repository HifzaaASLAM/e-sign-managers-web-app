"""Remove leftover Electricity Bill maintenance sample row."""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"


def main():
    work = ROOT / "scripts" / ".os-electricity-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    with zipfile.ZipFile(TEMPLATE, "r") as zin:
        zin.extractall(work)

    doc_path = work / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")

    pattern = re.compile(r"<w:tr\b[\s\S]*?</w:tr>")
    for match in list(pattern.finditer(xml)):
        row = match.group(0)
        if "Electricity Bill" in row and "{#maintenance_rows}" not in row:
            xml = xml.replace(row, "", 1)

    doc_path.write_text(xml, encoding="utf-8")

    if TEMPLATE.exists():
        TEMPLATE.unlink()
    with zipfile.ZipFile(TEMPLATE, "w", zipfile.ZIP_DEFLATED) as zout:
        for file in sorted(work.rglob("*")):
            if file.is_file():
                zout.write(file, file.relative_to(work).as_posix())

    shutil.copy2(TEMPLATE, PUBLIC)
    shutil.rmtree(work)
    print("Removed Electricity sample row")


if __name__ == "__main__":
    main()
