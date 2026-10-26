import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

matches = list(re.finditer(r"<w:t[^>]*>([^<]*)</w:t>", x))
print("nodes with dollar sign:", sum(1 for m in matches if "$" in m.group(1)))

for i, m in enumerate(matches):
    t = m.group(1)
    if "$" not in t and "{" not in t:
        continue
    if "{" in t:
        prev = matches[i - 1].group(1) if i > 0 else ""
        if "$" in prev or "$" in t:
            print("PLACEHOLDER ROW:", repr(prev), "+", repr(t))
    elif t.strip() == "$" or t == "$":
        nxt = matches[i + 1].group(1) if i + 1 < len(matches) else ""
        if "{" in nxt:
            print("LONE $ BEFORE:", repr(nxt))

# show maintenance subtotal row context
for label in ["{summary_maintenance}", "{total_fees_maintenance}", "{summary_rental_payments}"]:
    i = x.find(label)
    if i == -1:
        continue
    row_start = x.rfind("<w:tr", 0, i)
    row_end = x.find("</w:tr>", i) + len("</w:tr>")
    row = x[row_start:row_end]
    texts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", row)
    print(f"\nROW for {label}:")
    print(texts)
