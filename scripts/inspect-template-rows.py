import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

placeholders = [
    "{summary_maintenance}",
    "{total_fees_maintenance}",
    "{summary_paid_to_owner}",
    "{summary_paid_to_owner_negative}",
    "{summary_rental_payments}",
    "{summary_management_fees}",
    "{maintenance_total}",
    "{closing_balance}",
]

for label in placeholders:
    idx = 0
    n = 0
    while True:
        i = x.find(label, idx)
        if i == -1:
            break
        row_start = x.rfind("<w:tr", 0, i)
        row_end = x.find("</w:tr>", i) + len("</w:tr>")
        row = x[row_start:row_end]
        texts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", row)
        n += 1
        print(f"\n{n}. ROW for {label}:")
        print(texts)
        idx = i + len(label)
