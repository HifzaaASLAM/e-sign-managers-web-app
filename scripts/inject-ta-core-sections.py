"""Replace Premises..RTA block with [[CORE_SECTIONS]] placeholder."""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    ROOT / "lib" / "shm" / "templates" / "tenant-agreement-template.docx",
    ROOT / "public" / "shm-plugin-assets" / "templates" / "tenant-agreement-template.docx",
]
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


def inject_core(xml: str) -> tuple[str, bool]:
    if "[[CORE_SECTIONS]]" in xml:
        return xml, False
    start_idx = xml.find(">Premises</w:t>")
    if start_idx == -1:
        start_idx = xml.find("Premises")
    add_idx = xml.find("Additional terms")
    if start_idx == -1 or add_idx == -1 or add_idx <= start_idx:
        raise SystemExit("Could not locate Premises..Additional terms block")
    p_start = xml.rfind("<w:p", 0, start_idx)
    p_end = xml.rfind("<w:p", 0, add_idx)
    if p_start == -1 or p_end == -1 or p_end <= p_start:
        raise SystemExit("Could not expand paragraph bounds")
    replacement = (
        f'<w:p xmlns:w="{W}"><w:r>'
        f'<w:t xml:space="preserve">[[CORE_SECTIONS]]</w:t></w:r></w:p>'
    )
    return xml[:p_start] + replacement + xml[p_end:], True


def main() -> None:
    for path in PATHS:
        if not path.exists():
            print("skip missing", path)
            continue
        with zipfile.ZipFile(path, "r") as zin:
            files = {name: zin.read(name) for name in zin.namelist()}
        xml = merge_runs(files["word/document.xml"].decode("utf-8"))
        xml, changed = inject_core(xml)
        files["word/document.xml"] = xml.encode("utf-8")
        tmp = path.with_suffix(".tmp.docx")
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, data in files.items():
                zout.writestr(name, data)
        tmp.replace(path)
        print(path.name, "has CORE_SECTIONS", "[[CORE_SECTIONS]]" in xml, "changed", changed)


if __name__ == "__main__":
    main()
