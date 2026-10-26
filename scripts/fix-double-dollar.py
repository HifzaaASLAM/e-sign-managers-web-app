"""Remove template $ prefix before placeholders that already include $ from export."""
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx",
    ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx",
]

# Export uses formatMoney ($ prefix) for these placeholders.
STRIP_DOLLAR_BEFORE = (
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

RUN_RE = re.compile(r"<w:r\b[\s\S]*?</w:r>")


def run_text(run_xml: str) -> str:
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run_xml))


def strip_lone_dollars(xml: str) -> tuple[str, int]:
    runs = list(RUN_RE.finditer(xml))
    remove_spans: list[tuple[int, int]] = []

    for i, match in enumerate(runs):
        if run_text(match.group(0)) != "$":
            continue
        if i + 1 >= len(runs):
            continue
        nxt = run_text(runs[i + 1].group(0))
        if not nxt.startswith("{"):
            continue
        if not any(tag in nxt for tag in STRIP_DOLLAR_BEFORE):
            continue
        remove_spans.append(match.span())

    for start, end in reversed(remove_spans):
        xml = xml[:start] + xml[end:]

    return xml, len(remove_spans)


def fix_docx(path: Path) -> int:
    td = Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(path, "r") as zin:
            zin.extractall(td)
        doc = td / "word" / "document.xml"
        xml = doc.read_text(encoding="utf-8")
        xml, count = strip_lone_dollars(xml)
        if count:
            doc.write_text(xml, encoding="utf-8")
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
                for f in sorted(td.rglob("*")):
                    if f.is_file():
                        zout.write(f, f.relative_to(td).as_posix())
        return count
    finally:
        shutil.rmtree(td)


def main():
    for path in PATHS:
        if not path.exists():
            print(f"skip missing: {path}")
            continue
        n = fix_docx(path)
        print(f"{path.name}: removed {n} lone dollar run(s)")


if __name__ == "__main__":
    main()
