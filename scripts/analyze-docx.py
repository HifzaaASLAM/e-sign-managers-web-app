import re
import zipfile

path = r"C:\Users\Os\Downloads\esign-saas-phase11-3-ownership-remove-total-fees-field\public\shm-plugin-assets\templates\ownership-statement-template.docx"
with zipfile.ZipFile(path) as z:
    xml = z.read("word/document.xml").decode("utf-8")

fills = sorted(set(re.findall(r'w:fill="([A-Fa-f0-9]+)"', xml)))
colors = sorted(set(re.findall(r'w:color w:val="([A-Fa-f0-9]+)"', xml)))
sizes = sorted(set(re.findall(r'w:sz w:val="(\d+)"', xml)), key=int)
fonts = sorted(set(re.findall(r'w:ascii="([^"]+)"', xml)))
print("fills:", fills)
print("text colors:", colors[:15])
print("font sizes (half-pt):", sizes[:20])
print("fonts:", fonts)
print("tables:", xml.count("<w:tbl"))
