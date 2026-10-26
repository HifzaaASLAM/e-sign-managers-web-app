"""Rebuild tenant-agreement DOCX with valid placeholders (preserve header branding)."""
from __future__ import annotations

import re
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


def p_plain(text: str) -> str:
    return (
        f'<w:p xmlns:w="{W}"><w:pPr><w:spacing w:after="120"/></w:pPr>'
        f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    )


def p_bold(text: str, size: str = "22") -> str:
    return (
        f'<w:p xmlns:w="{W}"><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>'
        f'<w:r><w:rPr><w:b/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
        f'<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    )


def count_open(xml: str, open_tag: str, close_tag: str) -> int:
    # Count element opens carefully (ignore namespaces variants already using w:)
    opens = len(re.findall(rf"<{open_tag}(?:\s|>)", xml))
    closes = xml.count(f"</{close_tag}>")
    return opens - closes


def close_open_structures(xml: str) -> str:
    """Append/remove closers so the document fragment is structurally balanced."""
    for _ in range(500):
        p = count_open(xml, "w:p", "w:p")
        tc = count_open(xml, "w:tc", "w:tc")
        tr = count_open(xml, "w:tr", "w:tr")
        tbl = count_open(xml, "w:tbl", "w:tbl")
        if p == 0 and tc == 0 and tr == 0 and tbl == 0:
            break
        if p > 0:
            xml += "</w:p>"
            continue
        if tc > 0:
            xml += "</w:tc>"
            continue
        if tr > 0:
            xml += "</w:tr>"
            continue
        if tbl > 0:
            xml += "</w:tbl>"
            continue
        # Over-closed: remove the last excess closer for the most-nested tag first
        removed = False
        for tag in ("w:p", "w:tc", "w:tr", "w:tbl"):
            if count_open(xml, tag, tag) < 0:
                closer = f"</{tag}>"
                idx = xml.rfind(closer)
                if idx != -1:
                    xml = xml[:idx] + xml[idx + len(closer) :]
                    removed = True
                    break
        if not removed:
            break
    return xml


def find_cut_points(xml: str) -> tuple[int, int]:
    """Return (prefix_end, suffix_start) indexes for inserting placeholders."""
    premises = xml.find(">Premises</w:t>")
    if premises == -1:
        premises = xml.find("Premises")
    ack = xml.find("Acknowledgement")
    if premises == -1 or ack == -1 or ack <= premises:
        raise SystemExit("Could not find Premises / Acknowledgement markers")

    # Cut before the Premises table (never mid-table).
    tbl_before = xml.rfind("<w:tbl", 0, premises)
    p_before = xml.rfind("<w:p", 0, premises)
    if tbl_before != -1:
        prefix_end = tbl_before
    elif p_before != -1:
        prefix_end = p_before
    else:
        prefix_end = premises

    # Suffix must start at the table (or paragraph) that contains Acknowledgement,
    # so we keep its open tags paired with its closers.
    ack_tbl = xml.rfind("<w:tbl", 0, ack)
    ack_p = xml.rfind("<w:p", 0, ack)
    if ack_tbl != -1 and (ack_p == -1 or ack_tbl > prefix_end):
        # Only use ack table if it is after the prefix cut (the remaining document body tables)
        suffix_start = ack_tbl
    elif ack_p != -1:
        suffix_start = ack_p
    else:
        suffix_start = ack

    if suffix_start <= prefix_end:
        raise SystemExit("Invalid cut points overlapping")
    return prefix_end, suffix_start


def build_placeholder_block() -> str:
    return "".join(
        [
            p_plain("[[CORE_SECTIONS]]"),
            p_bold("Additional terms", "24"),
            p_plain(
                "Additional terms which do not take away the rights and duties included "
                "in the Residential Tenancies Act 1997 may be set out in this Section."
            ),
            p_plain("[[ADDITIONAL_TERMS]]"),
            p_bold("Additional Share House Rules and Terms for Co-Tenancy Agreement", "24"),
            p_plain("[[ADDITIONAL_SHARE_HOUSE_RULES]]"),
        ]
    )


def rebuild(xml: str) -> str:
    xml = merge_runs(xml)
    xml = xml.replace("[[Date_BondPayment]]", "[[BOND_PAYMENT_DUE]]")

    prefix_end, suffix_start = find_cut_points(xml)
    prefix = close_open_structures(xml[:prefix_end])
    suffix = xml[suffix_start:]
    out = prefix + build_placeholder_block() + suffix

    for required in ("[[CORE_SECTIONS]]", "[[ADDITIONAL_TERMS]]", "[[ADDITIONAL_SHARE_HOUSE_RULES]]"):
        if required not in out:
            raise SystemExit(f"Missing {required}")

    # Placeholders must be direct children of body-level paragraphs, not inside pPr
    for ph in ("[[CORE_SECTIONS]]", "[[ADDITIONAL_TERMS]]", "[[ADDITIONAL_SHARE_HOUSE_RULES]]"):
        i = out.find(ph)
        # Find containing paragraph start
        p_start = out.rfind("<w:p", 0, i)
        chunk = out[p_start:i]
        if "<w:pPr>" in chunk and "</w:pPr>" not in chunk:
            raise SystemExit(f"{ph} nested inside unfinished pPr")

    return out


def write_docx(path: Path, files: dict[str, bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)
    tmp.replace(path)
    print("Wrote", path)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source template: {SRC}")
    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}
    xml = files["word/document.xml"].decode("utf-8")
    rebuilt = rebuild(xml)
    files["word/document.xml"] = rebuilt.encode("utf-8")
    write_docx(LIB, files)
    write_docx(PUB, files)

    # Report balance
    print("tc delta", count_open(rebuilt, "w:tc", "w:tc"))
    print("tr delta", count_open(rebuilt, "w:tr", "w:tr"))
    print("tbl delta", count_open(rebuilt, "w:tbl", "w:tbl"))
    print("p delta", count_open(rebuilt, "w:p", "w:p"))


if __name__ == "__main__":
    main()
