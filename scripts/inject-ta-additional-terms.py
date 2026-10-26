"""Replace static additional-terms clauses in tenant agreement DOCX with [[ADDITIONAL_TERMS]]."""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "lib" / "shm" / "templates" / "tenant-agreement-template.docx"
PUBLIC = ROOT / "public" / "shm-plugin-assets" / "templates" / "tenant-agreement-template.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def merge_runs(xml: str) -> str:
    pattern = re.compile(
        r"</w:t></w:r><w:r[^>]*>(?:<w:rPr>(?:[^<]|<(?!/?w:rPr>))*</w:rPr>)?<w:t[^>]*>"
    )
    prev = ""
    next_xml = xml.replace("<w:tab/>", "\t")
    while next_xml != prev:
        prev = next_xml
        next_xml = pattern.sub("", next_xml)
    return next_xml


def para_start_before(xml: str, marker: str) -> int:
    idx = xml.find(marker)
    if idx == -1:
        return -1
    start = xml.rfind("<w:p", 0, idx)
    return start if start != -1 else idx


def inject(xml: str) -> str:
    if "[[ADDITIONAL_TERMS]]" in xml:
        return xml

    start_marker = "Water consumption"
    end_marker = "I hereby acknowledge"
    start = para_start_before(xml, start_marker)
    end = para_start_before(xml, end_marker)
    if start == -1 or end == -1 or end <= start:
        raise SystemExit(f"Could not locate additional terms block ({start_marker} -> {end_marker}).")

    replacement = (
        f'<w:p xmlns:w="{W}">'
        f'<w:r><w:t xml:space="preserve">[[ADDITIONAL_TERMS]]</w:t></w:r></w:p>'
    )
    return xml[:start] + replacement + xml[end:]


def write_docx(path: Path, files: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    print("Wrote", path)


def main():
    if not TEMPLATE.exists():
        raise SystemExit(f"Missing template: {TEMPLATE}")

    with zipfile.ZipFile(TEMPLATE, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = merge_runs(files["word/document.xml"].decode("utf-8"))
    xml = inject(xml)
    if "[[ADDITIONAL_TERMS]]" not in xml:
        raise SystemExit("Failed to inject [[ADDITIONAL_TERMS]]")

    files["word/document.xml"] = xml.encode("utf-8")
    write_docx(TEMPLATE, files)
    write_docx(PUBLIC, files)
    print("Additional terms placeholder ready.")


if __name__ == "__main__":
    main()
