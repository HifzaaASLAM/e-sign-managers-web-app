import re
import zipfile
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lib" / "shm" / "templates" / "ownership-statement-template.docx"
x = zipfile.ZipFile(p).read("word/document.xml").decode("utf-8")

run_re = re.compile(r"<w:r\b[\s\S]*?</w:r>")
runs = list(run_re.finditer(x))

FORMAT_MONEY_TAGS = (
    "summary_maintenance",
    "summary_paid_to_owner",
    "total_fees_maintenance",
    "summary_rental_payments",
    "summary_management_fees",
    "summary_paid_to_owner_negative",
    "closing_balance",
    "ownership_payment",
    "fee_total",
    "fee_gst",
    "fee_money_out",
    "total_rent",
    "opening_balance",
)

def run_text(run_xml: str) -> str:
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run_xml))

hits = []
for i, m in enumerate(runs):
    text = run_text(m.group(0))
    if text != "$":
        continue
    if i + 1 >= len(runs):
        continue
    nxt = run_text(runs[i + 1].group(0))
    if nxt.startswith("{") and any(tag in nxt for tag in FORMAT_MONEY_TAGS):
        hits.append((text, nxt[:60]))

print("lone $ before formatMoney placeholders:", len(hits))
for h in hits:
    print(" ", h)
