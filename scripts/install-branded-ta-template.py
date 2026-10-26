"""Install branded tenant agreement DOCX and inject selectable-terms placeholders."""
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"c:\Users\Os\Downloads\tenant-agreement-template (1) (1).docx")
LIB = ROOT / "lib" / "shm" / "templates" / "tenant-agreement-template.docx"
PUB = ROOT / "public" / "shm-plugin-assets" / "templates" / "tenant-agreement-template.docx"
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


def inject_after(xml: str, marker: str, insertion: str) -> str:
    idx = xml.find(marker)
    if idx == -1:
        return xml
    para_end = xml.find("</w:p>", idx)
    if para_end == -1:
        return xml[:idx] + insertion + xml[idx:]
    para_end += len("</w:p>")
    return xml[:para_end] + insertion + xml[para_end:]


def replace_static_additional_terms(xml: str) -> str:
    """Replace static Water consumption ... General & Miscellaneous with placeholder if present."""
    if "[[ADDITIONAL_TERMS]]" in xml:
        return xml

    start = xml.find("Water consumption")
    if start == -1:
        start = xml.find("Additional terms which do not take away")
        if start != -1:
            # skip intro paragraph; find next clause block
            pass
    # Prefer replacing from Water consumption through before Acknowledgement / Share House Rules
    start = xml.find("Water consumption")
    end_markers = [
        "Additional Share House Rules and Terms for Co-Tenancy Agreement",
        "Acknowledgement",
        "I hereby acknowledge",
    ]
    end = -1
    for m in end_markers:
        end = xml.find(m)
        if end != -1:
            break
    if start == -1 or end == -1 or end <= start:
        # Just insert placeholder after Additional terms intro
        insertion = (
            f'<w:p xmlns:w="{W}"><w:r>'
            f'<w:t xml:space="preserve">[[ADDITIONAL_TERMS]]</w:t></w:r></w:p>'
        )
        return inject_after(xml, "Additional terms which do not take away", insertion)

    # expand to paragraph starts
    p_start = xml.rfind("<w:p", 0, start)
    p_end = xml.rfind("<w:p", 0, end)
    if p_start == -1 or p_end == -1 or p_end <= p_start:
        return xml
    replacement = (
        f'<w:p xmlns:w="{W}"><w:r>'
        f'<w:t xml:space="preserve">[[ADDITIONAL_TERMS]]</w:t></w:r></w:p>'
    )
    return xml[:p_start] + replacement + xml[p_end:]


def ensure_share_house_rules(xml: str) -> str:
    if "[[ADDITIONAL_SHARE_HOUSE_RULES]]" in xml:
        return xml
    insertion = (
        f'<w:p xmlns:w="{W}">'
        f'<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr>'
        f"<w:t>Additional Share House Rules and Terms for Co-Tenancy Agreement</w:t></w:r></w:p>"
        f'<w:p xmlns:w="{W}"><w:r><w:t xml:space="preserve">[[ADDITIONAL_SHARE_HOUSE_RULES]]</w:t></w:r></w:p>'
    )
    for tip in ("Acknowledgement", "I hereby acknowledge", "Electronic Signatures"):
        tip_idx = xml.find(tip)
        if tip_idx != -1:
            p_start = xml.rfind("<w:p", 0, tip_idx)
            if p_start == -1:
                p_start = tip_idx
            return xml[:p_start] + insertion + xml[p_start:]
    return xml + insertion


def write_docx(path: Path, files: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    print("Wrote", path)


def main():
    if not SRC.exists():
        raise SystemExit(f"Missing source: {SRC}")

    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = merge_runs(files["word/document.xml"].decode("utf-8"))
    # Normalize bond due placeholder alias
    xml = xml.replace("[[Date_BondPayment]]", "[[BOND_PAYMENT_DUE]]")
    xml = replace_static_additional_terms(xml)
    xml = ensure_share_house_rules(xml)

    for required in ("[[ADDITIONAL_TERMS]]", "[[ADDITIONAL_SHARE_HOUSE_RULES]]", "[[BOND_PAYMENT_DUE]]"):
        if required not in xml:
            raise SystemExit(f"Missing after inject: {required}")

    files["word/document.xml"] = xml.encode("utf-8")
    write_docx(LIB, files)
    write_docx(PUB, files)
    print("Branded tenant agreement template installed.")


if __name__ == "__main__":
    main()
