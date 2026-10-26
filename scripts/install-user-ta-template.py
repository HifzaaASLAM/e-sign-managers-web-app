"""Install user reference DOCX as tenant agreement template.

Keeps the full branded layout (Premises..RTA + field placeholders) and injects
[[ADDITIONAL_TERMS]] / [[ADDITIONAL_SHARE_HOUSE_RULES]] for creator selections.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"c:\Users\Os\Downloads\tenant-agreement-template (1) (2).docx")
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


def para(text: str, *, bold: bool = False, before: int = 0, after: int = 120, size: int = 20) -> str:
    weight = "<w:b/>" if bold else ""
    rpr = f'<w:rPr>{weight}<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
    return (
        f'<w:p xmlns:w="{W}">'
        f'<w:pPr><w:spacing w:before="{before}" w:after="{after}"/></w:pPr>'
        f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'
        f"</w:p>"
    )


def find_real_paragraph_start(xml: str, idx: int) -> int:
    """Find the real <w:p ...> / <w:p> that contains idx (not <w:pPr>/<w:pgSz>)."""
    open_re = re.compile(r"<w:p(?:\s[^>]*)?>")
    start = -1
    for match in open_re.finditer(xml):
        if match.start() > idx:
            break
        start = match.start()
    return start if start != -1 else idx


def find_table_or_para_start(xml: str, idx: int) -> int:
    tbl = xml.rfind("<w:tbl", 0, idx)
    p = find_real_paragraph_start(xml, idx)
    if tbl != -1 and tbl > p:
        return tbl
    return p


def scrub_orphans_before_ack(xml: str) -> str:
    """Remove orphaned table/paragraph-property fragments between rules placeholder and Acknowledgement."""
    marker = "[[ADDITIONAL_SHARE_HOUSE_RULES]]"
    ph = xml.find(marker)
    if ph == -1:
        return xml
    ph_end = xml.find("</w:p>", ph)
    if ph_end == -1:
        return xml
    ph_end += len("</w:p>")

    ack = xml.find("Acknowledgement", ph_end)
    if ack == -1:
        ack = xml.find("I hereby acknowledge", ph_end)
    if ack == -1:
        return xml

    # Prefer a clean table that contains Acknowledgement; else the Acknowledgement paragraph.
    tbl = xml.rfind("<w:tbl", ph_end, ack)
    nxt = tbl if tbl >= ph_end else find_real_paragraph_start(xml, ack)
    if nxt > ph_end:
        xml = xml[:ph_end] + xml[nxt:]
    return xml


def inject(xml: str) -> str:
    xml = merge_runs(xml)
    xml = xml.replace("[[Date_BondPayment]]", "[[BOND_PAYMENT_DUE]]")

    # Replace static additional-terms clauses with placeholder.
    if "[[ADDITIONAL_TERMS]]" not in xml:
        water_markers = [
            "Water consumption",
            "11. Water",
            "Water consumption &amp; utilities",
        ]
        water = -1
        for m in water_markers:
            water = xml.find(m)
            if water != -1:
                break

        ack = xml.find("Acknowledgement")
        if ack == -1:
            ack = xml.find("I hereby acknowledge")

        if water != -1 and ack != -1 and water < ack:
            start = find_real_paragraph_start(xml, water)
            end = find_table_or_para_start(xml, ack)
            xml = xml[:start] + para("[[ADDITIONAL_TERMS]]", after=160) + xml[end:]
        else:
            intro = xml.find("Additional terms which do not take away")
            if intro == -1:
                raise SystemExit("Could not locate Additional terms section")
            intro_end = xml.find("</w:p>", intro)
            if intro_end == -1:
                raise SystemExit("Could not close Additional terms intro paragraph")
            intro_end += len("</w:p>")
            xml = xml[:intro_end] + para("[[ADDITIONAL_TERMS]]", after=160) + xml[intro_end:]

    # Insert share-house rules section before Acknowledgement.
    if "[[ADDITIONAL_SHARE_HOUSE_RULES]]" not in xml:
        ack = xml.find("Acknowledgement")
        if ack == -1:
            ack = xml.find("I hereby acknowledge")
        if ack == -1:
            raise SystemExit("Could not find Acknowledgement")
        end = find_table_or_para_start(xml, ack)
        insertion = (
            para(
                "Additional Share House Rules and Terms for Co-Tenancy Agreement",
                bold=True,
                before=200,
                after=80,
                size=24,
            )
            + para("[[ADDITIONAL_SHARE_HOUSE_RULES]]", after=160)
        )
        xml = xml[:end] + insertion + xml[end:]

    xml = scrub_orphans_before_ack(xml)

    required = [
        "[[AGREEMENT_DATE]]",
        "[[PROVIDER_NAME]]",
        "[[TENANT_NAME]]",
        "[[TENANT_EMAIL]]",
        "[[PREMISES_ADDRESS]]",
        "[[MONTHLY_RENT]]",
        "[[WEEKLY_RENT]]",
        "[[BOND_AMOUNT]]",
        "[[BOND_PAYMENT_DUE]]",
        "[[COMMENCEMENT_DATE]]",
        "[[TERMINATE_DATE]]",
        "[[ADDITIONAL_TERMS]]",
        "[[ADDITIONAL_SHARE_HOUSE_RULES]]",
        "[[TENANT_NAME_SIG]]",
        "[[PROVIDER_NAME_SIG]]",
        "[[DOCUMENT_ID]]",
        "Premises",
        "Acknowledgement",
    ]
    missing = [r for r in required if r not in xml]
    if missing:
        raise SystemExit(f"Missing after inject: {missing}")

    # Detect obvious orphan fragments right after rules placeholder
    ph = xml.find("[[ADDITIONAL_SHARE_HOUSE_RULES]]")
    ph_end = xml.find("</w:p>", ph) + len("</w:p>")
    gap = xml[ph_end : ph_end + 80]
    if gap.startswith("<w:pBdr") or gap.startswith("<w:tblCellMar") or gap.startswith("<w:shd"):
        raise SystemExit(f"Orphan fragment after rules placeholder: {gap[:60]!r}")

    return xml


def write_docx(dest: Path, files: dict[str, bytes], xml: str) -> None:
    payload = dict(files)
    payload["word/document.xml"] = xml.encode("utf-8")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.docx")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in payload.items():
            zout.writestr(name, data)
    tmp.replace(dest)
    print("Wrote", dest, "bytes", dest.stat().st_size)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source: {SRC}")

    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = inject(files["word/document.xml"].decode("utf-8"))
    write_docx(LIB, files, xml)
    write_docx(PUB, files, xml)

    media = "word/media/image1.png"
    if media in files:
        img_dir = ROOT / "public" / "shm-plugin-assets" / "images"
        img_dir.mkdir(parents=True, exist_ok=True)
        header = img_dir / "tenant-agreement-header.png"
        header.write_bytes(files[media])
        print("Wrote header image", header)

    print("OK — template installed from user reference DOCX")


if __name__ == "__main__":
    main()
