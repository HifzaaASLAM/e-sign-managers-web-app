import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")
for m in re.finditer(r"<w:t[^>]*>([^<]*)</w:t>", x):
    t = m.group(1)
    if "$" in t and "{" in t and not t.strip().startswith("{"):
        print(repr(t))
