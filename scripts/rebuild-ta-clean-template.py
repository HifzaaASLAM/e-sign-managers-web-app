"""Rebuild tenant-agreement-template.docx with clean body placeholders."""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_CANDIDATES = [
    Path(r"c:\Users\Os\Downloads\tenant-agreement-template (1) (1).docx"),
    ROOT / "lib" / "shm" / "templates" / "tenant-agreement-brand-source.docx",
    ROOT / "lib" / "shm" / "templates" / "tenant-agreement-template.docx",
]
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


def p(text: str, *, bold: bool = False, before: int = 0, after: int = 100, size: int = 20) -> str:
    weight = "<w:b/>" if bold else ""
    rpr = f'<w:rPr>{weight}<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
    spacing = f'<w:spacing w:before="{before}" w:after="{after}"/>'
    return (
        f'<w:p xmlns:w="{W}"><w:pPr>{spacing}</w:pPr>'
        f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    )


def rebuild_body(xml: str) -> str:
    xml = merge_runs(xml)
    xml = xml.replace("[[Date_BondPayment]]", "[[BOND_PAYMENT_DUE]]")

    start = xml.find(">Premises</w:t>")
    if start == -1:
        start = xml.find("Premises")
    if start == -1:
        raise SystemExit("Could not find Premises in source template")
    p_start = xml.rfind("<w:p", 0, start)
    if p_start == -1:
        raise SystemExit("Could not find Premises paragraph start")

    # Keep section properties at the end of body.
    sect = xml.rfind("<w:sectPr")
    if sect == -1:
        raise SystemExit("Could not find sectPr")

    insertion = "".join(
        [
            p("[[CORE_SECTIONS]]", after=160),
            p("Additional terms", bold=True, before=200, after=80, size=24),
            p(
                "Additional terms which do not take away the rights and duties included in the Residential Tenancies Act 1997 may be set out in this Section.",
                after=100,
            ),
            p("[[ADDITIONAL_TERMS]]", after=160),
            p(
                "Additional Share House Rules and Terms for Co-Tenancy Agreement",
                bold=True,
                before=200,
                after=80,
                size=24,
            ),
            p("[[ADDITIONAL_SHARE_HOUSE_RULES]]", after=160),
            p("Acknowledgement", bold=True, before=220, after=60, size=24),
            p("I hereby acknowledge that I have read and understood the above conditions.", after=120),
            p("Electronic Signatures", bold=True, before=200, after=80, size=24),
            p("[[TENANT_NAME_SIG]]", after=40),
            p("[[PROVIDER_NAME_SIG]]", after=40),
            p("Email: [[TENANT_EMAIL_SIG]]", after=40),
            p("Email: [[PROVIDER_EMAIL_SIG]]", after=40),
            p("[[SIGNED_DATETIME]]", after=40),
            p("[[SIGNED_DATETIME]]", after=120),
            p("Audit trail", bold=True, before=200, after=80, size=24),
            p("[[AUDIT_SENT_TENANT]]", after=40),
            p("[[AUDIT_SENT_PROVIDER]]", after=40),
            p("[[AUDIT_VIEWED]]", after=40),
            p("[[AUDIT_VERIFIED]]", after=40),
            p("[[AUDIT_SIGNED]]", after=40),
            p("[[AUDIT_FINALIZED]]", after=40),
            p("ID: [[DOCUMENT_ID]]", after=120),
        ]
    )

    out = xml[:p_start] + insertion + xml[sect:]

    required = [
        "[[CORE_SECTIONS]]",
        "[[ADDITIONAL_TERMS]]",
        "[[ADDITIONAL_SHARE_HOUSE_RULES]]",
        "[[TENANT_NAME_SIG]]",
        "[[PROVIDER_NAME_SIG]]",
        "[[TENANT_EMAIL_SIG]]",
        "[[PROVIDER_EMAIL_SIG]]",
        "[[SIGNED_DATETIME]]",
        "[[AUDIT_SENT_TENANT]]",
        "[[DOCUMENT_ID]]",
        "Acknowledgement",
    ]
    for needle in required:
        if needle not in out:
            raise SystemExit(f"Missing {needle}")

    # No orphan table props in the insertion zone
    zone = out[p_start:sect]
    if "tblCellMar" in zone or "tblPrEx" in zone:
        raise SystemExit("Orphan table fragments still present in rebuilt zone")

    return out


def write_docx(dest: Path, files: dict, xml: str) -> None:
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
    src = next((p for p in SRC_CANDIDATES if p.exists()), None)
    if not src:
        raise SystemExit("No source DOCX found")
    print("Source:", src)

    with zipfile.ZipFile(src, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    rebuilt = rebuild_body(files["word/document.xml"].decode("utf-8"))
    write_docx(LIB, files, rebuilt)
    write_docx(PUB, files, rebuilt)
    print("rebuild ok")


if __name__ == "__main__":
    main()
