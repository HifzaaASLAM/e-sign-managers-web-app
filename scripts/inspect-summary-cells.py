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
        cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
        print("cell count:", len(cells))
        for ci, cell in enumerate(cells):
            texts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", cell)
            runs = re.findall(r"<w:r\b[\s\S]*?</w:r>", cell)
            print(f"cell {ci} texts={texts} runs={len(runs)}")
        break
    i = x.find("SUBTOTAL   ", i + 1)
