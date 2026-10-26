"""Remove stray $1902 prefix before {summary_management_fees} in OS template."""
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = [
    ROOT / "lib" / "shm" / "templates" / "ownership-statement-template.docx",
    ROOT / "public" / "shm-plugin-assets" / "templates" / "ownership-statement-template.docx",
]

OLD = "$1902{summary_management_fees}"
NEW = "{summary_management_fees}"


def fix_docx(path: Path) -> int:
    td = Path(tempfile.mkdtemp())
    try:
        with zipfile.ZipFile(path, "r") as zin:
            zin.extractall(td)
        doc = td / "word" / "document.xml"
        xml = doc.read_text(encoding="utf-8")
        count = xml.count(OLD)
        if count:
            xml = xml.replace(OLD, NEW)
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
        print(f"{path.name}: replaced {n} occurrence(s)")


if __name__ == "__main__":
    main()
