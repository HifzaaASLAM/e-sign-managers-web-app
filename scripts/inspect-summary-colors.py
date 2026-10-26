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
        for n, r in enumerate(runs):
            t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r))
            color = re.search(r'w:color w:val="([^"]+)"', r)
            print(n, repr(t), "color", color.group(1) if color else None)
        break
    i = x.find("SUBTOTAL   ", i + 1)
