import shutil
import zipfile
from pathlib import Path

SRC = Path(r"C:\Users\Os\Downloads\52_102-May 26 Ownership Statement (1).docx")
temp = Path(__file__).resolve().parent / ".check-work5"
shutil.rmtree(temp, ignore_errors=True)
temp.mkdir()
with zipfile.ZipFile(SRC) as z:
    z.extractall(temp)
xml = (temp / "word" / "document.xml").read_text(encoding="utf-8")

steps = [
    ("30/05/26", "{ownership_payment_date}"),
    ("May26. Rent Payment - 01/05/26 To 31/05/26", "{ownership_payment_description}"),
    ("$2102.45", "{total_fees_maintenance}"),
    ("$17295", "{summary_rental_payments}"),
    ("$15192.55", "{summary_paid_to_owner}"),
]
for old, new in steps:
    xml = xml.replace(old, new)
    print(old, "->", "{ownership_payment_date}" in xml)
