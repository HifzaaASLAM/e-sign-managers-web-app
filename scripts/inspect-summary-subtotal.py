import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

# Summary SUBTOTAL row (PROPERTY INCOME section)
i = x.find("SUBTOTAL   ")
while i != -1:
    row_start = x.rfind("<w:tr", 0, i)
    row_end = x.find("</w:tr>", i) + len("</w:tr>")
    row = x[row_start:row_end]
    if "summary_rental_payments" in row and "summary_management" not in row:
        print("SUMMARY SUBTOTAL ROW XML snippet:")
        texts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", row)
        print(texts)
        # per cell
        cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
        for ci, cell in enumerate(cells):
            ct = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", cell)
            if ct:
                print(f"  cell {ci}:", ct)
    i = x.find("SUBTOTAL   ", i + 1)
