import re
import zipfile
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "lib/shm/templates/ownership-statement-template.docx"
xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
print("paraId corrupt", bool(re.search(r'paraId="[^"]*maintenance', xml)))
i = xml.find("{#maintenance_rows}")
r = xml[xml.rfind("<w:tr", 0, i) : xml.find("</w:tr>", i) + 7]
print("MAINT row", [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r) if t.strip()])
i = xml.find("{ownership_payment_date}")
r = xml[xml.rfind("<w:tr", 0, i) : xml.find("</w:tr>", i) + 7]
print("OWN row", [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", r) if t.strip()])
print("Electricity", "Electricity" in xml)
print("placeholders", len(set(re.findall(r"\{[#/]?[^{}]+\}", xml))))
