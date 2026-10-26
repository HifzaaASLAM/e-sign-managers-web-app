import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

for needle in ["{summary_paid_to_owner}", "{summary_maintenance}"]:
    idx = 0
    n = 0
    while True:
        i = x.find(needle, idx)
        if i == -1:
            break
        row_start = x.rfind("<w:tr", 0, i)
        row_end = x.find("</w:tr>", i) + len("</w:tr>")
        row = x[row_start:row_end]
        cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
        n += 1
        print(f"\n{n}. {needle} row cells:")
        for ci, cell in enumerate(cells):
            ct = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", cell)
            if ct:
                print(f"  {ci}:", ct)
        idx = i + len(needle)
