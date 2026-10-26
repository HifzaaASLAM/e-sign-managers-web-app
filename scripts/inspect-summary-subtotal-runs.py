import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

i = x.find("SUBTOTAL   ")
while i != -1:
    row_start = x.rfind("<w:tr", 0, i)
    row_end = x.find("</w:tr>", i) + len("</w:tr>")
    row = x[row_start:row_end]
    if "summary_rental_payments" in row and row.count("summary_rental_payments") >= 2:
        runs = re.findall(r"<w:r\b[\s\S]*?</w:r>", row)
        print("SUMMARY SUBTOTAL runs:")
        for r in runs:
            t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r))
            if t.strip():
                print(repr(t))
        break
    i = x.find("SUBTOTAL   ", i + 1)
