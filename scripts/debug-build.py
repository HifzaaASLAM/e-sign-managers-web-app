import re
import shutil
import zipfile
from pathlib import Path

SRC = Path(r"C:\Users\Os\Downloads\52_102-May 26 Ownership Statement (1).docx")
temp = Path(__file__).resolve().parent / ".debug-build"
shutil.rmtree(temp, ignore_errors=True)
temp.mkdir()
with zipfile.ZipFile(SRC) as z:
    z.extractall(temp)
xml = (temp / "word" / "document.xml").read_text(encoding="utf-8")

STATIC_REPLACEMENTS = [
    ("30/05/26", "{ownership_payment_date}"),
    ("May26. Rent Payment - 01/05/26 To 31/05/26", "{ownership_payment_description}"),
    ("$2102.45", "{total_fees_maintenance}"),
    ("$17295", "{summary_rental_payments}"),
    ("$15192.55", "{summary_paid_to_owner}"),
]

def show(label):
    for r in re.findall(r"<w:tr\b[\s\S]*?</w:tr>", xml):
        if "{ownership_payment_date}" in r:
            print(label, [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r) if t.strip()])
            return

show("start-after-read")

for old, new in STATIC_REPLACEMENTS:
    xml = xml.replace(old, new)
    show(f"after {old}")
