import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

# Find maintenance section header row
i = x.find("PROPERTY MAINTENANCE")
section = x[i : i + 15000]
rows = re.findall(r"<w:tr\b[\s\S]*?</w:tr>", section)
for n, row in enumerate(rows[:4]):
    cells = re.findall(r"<w:tc\b[\s\S]*?</w:tc>", row)
    print(f"\nrow {n} ({len(cells)} cells):")
    for ci, cell in enumerate(cells):
        texts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", cell)
        if texts:
            print(f"  {ci}:", texts)
