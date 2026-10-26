"""Replace remaining hardcoded dollar amounts in the ownership statement template."""

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx"

# Order matters: longer / more specific strings first.
AMOUNT_REPLACEMENTS = [
    ("$17295                         $17295", "{summary_rental_payments}                         {summary_rental_payments}"),
    ("$1902.45          $0.00", "{summary_management_fees}          $0.00"),
    ("-$1902.45", "{fee_total}"),
    ("$2102.45", "{total_fees_maintenance}"),
    ("$17295", "{summary_rental_payments}"),
    ("$15192.55", "{summary_paid_to_owner}"),
    ("$568.52", "{summary_maintenance}"),
    (">${summary_", ">{"),  # fix broken $ + placeholder merges
]


def strip_dollar_before_placeholders(xml: str) -> str:
    return re.sub(
        r"(<w:t[^>]*>)\$(</w:t>\s*</w:r>\s*(?:<w:r[^>]*>\s*<w:rPr>[\s\S]*?</w:rPr>\s*)?<w:t[^>]*>)(\{[^{}]+\})",
        r"\1\3",
        xml,
    )


def main():
    work = ROOT / "scripts" / ".os-amounts-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    with zipfile.ZipFile(TEMPLATE, "r") as zin:
        zin.extractall(work)

    doc_path = work / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")

    for old, new in AMOUNT_REPLACEMENTS:
        if old in xml:
            xml = xml.replace(old, new)

    xml = strip_dollar_before_placeholders(xml)

    doc_path.write_text(xml, encoding="utf-8")

    if TEMPLATE.exists():
        TEMPLATE.unlink()
    with zipfile.ZipFile(TEMPLATE, "w", zipfile.ZIP_DEFLATED) as zout:
        for file in sorted(work.rglob("*")):
            if file.is_file():
                zout.write(file, file.relative_to(work).as_posix())

    shutil.copy2(TEMPLATE, PUBLIC)
    shutil.rmtree(work)

    import subprocess
    import sys

    subprocess.run([sys.executable, str(ROOT / "scripts" / "fix-os-ownership-ref.py")], check=True)
    print("Fixed dollar amounts in template")


if __name__ == "__main__":
    main()
