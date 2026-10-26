"""Embed the Tenant Agreement Word template and normalize placeholders."""
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"c:\Users\Os\Downloads\tenant-agreement-template (1).docx")
OUT = ROOT / "lib" / "shm" / "templates" / "tenant-agreement-template.docx"
PUBLIC_OUT = ROOT / "public" / "shm-plugin-assets" / "templates" / "tenant-agreement-template.docx"
SOURCE_COPY = ROOT / "public" / "shm-plugin-assets" / "templates" / "tenant-agreement-template-source.docx"


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


def main():
    if not SRC.exists():
        raise SystemExit(f"Missing source template: {SRC}")

    SOURCE_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, SOURCE_COPY)

    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = merge_runs(files["word/document.xml"].decode("utf-8"))
    xml = xml.replace("[[Date_BondPayment]]", "[[BOND_PAYMENT_DUE]]")

    # Second email under signatures is provider email.
    first = xml.find("[[TENANT_EMAIL_SIG]]")
    if first != -1:
        second = xml.find("[[TENANT_EMAIL_SIG]]", first + 1)
        if second != -1:
            xml = (
                xml[:second]
                + "[[PROVIDER_EMAIL_SIG]]"
                + xml[second + len("[[TENANT_EMAIL_SIG]]") :]
            )

    files["word/document.xml"] = xml.encode("utf-8")

    placeholders = sorted(set(re.findall(r"\[\[[A-Z0-9_]+\]\]", xml)))
    print("Placeholders:")
    for p in placeholders:
        print(" ", p)

    for dest in (OUT, PUBLIC_OUT):
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, data in files.items():
                zout.writestr(name, data)
        print("Wrote", dest, f"({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
