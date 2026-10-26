"""Inject [[PLACEHOLDER]] tokens into the property management agreement DOCX template."""
import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "shm-plugin-assets" / "templates" / "property-management-agreement-template.docx"
OUT = ROOT / "lib" / "shm" / "templates" / "property-management-agreement-template.docx"
PUBLIC_OUT = SRC

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


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


def paragraph_text(paragraph) -> str:
    return "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()


def ensure_placeholder_paragraph(cell, placeholder: str):
    import xml.etree.ElementTree as ET

    paragraphs = cell.findall("w:p", NS)
    target = paragraphs[1] if len(paragraphs) > 1 else None
    if target is None:
        target = ET.Element(f"{{{W_NS}}}p")
        cell.append(target)

    for child in list(target):
        target.remove(child)

    run = ET.SubElement(target, f"{{{W_NS}}}r")
    text = ET.SubElement(run, f"{{{W_NS}}}t")
    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = placeholder


def inject_table_placeholders(xml: str) -> str:
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml)
    rows = root.findall(".//w:tr", NS)
    row_placeholders = [
        ["[[PROPERTY]]"],
        ["[[BLOCK]]", "[[SECTION]]", "[[DIVISION]]", "[[EER]]"],
        ["[[OWNER]]", "[[POSTAL_ADDRESS]]"],
        ["[[PHONE_AH]]", "[[PHONE_BH]]", "[[MOBILE]]", "[[EMAIL]]"],
        ["[[UNIT_PLAN_NO]]", "[[UNIT_PLAN_MANAGER]]", "[[UNIT_PHONE]]", "[[FAX]]"],
        ["[[DESCRIPTION]]"],
        ["[[PROPERTY_TYPE]]"],
        ["[[HEATING]]", "[[HOT_WATER]]", "[[DISHWASHER]]"],
        ["[[OVEN]]", "[[COOKTOP]]", "[[WARRANTIES]]"],
        ["[[RENT_PW]]", "[[LEASE_TERM]]", "[[KEYS]]"],
        ["[[DEPOSIT_TO]]"],
        ["[[BANK]]", "[[BRANCH]]", "[[BSB]]", "[[ACCOUNT]]"],
        ["[[REPAIRS]]"],
        ["[[ASBESTOS]]"],
        ["[[GLASS]]"],
        ["[[SMOKE]]"],
        ["[[STRUCTURES]]"],
        ["[[RATES_GENERAL]]", "[[RATES_WATER]]", "[[LAND_TAX]]", "[[PREFERRED_CONTACT]]"],
        ["[[BODY_CORP]]", "[[FAIR_CLAUSE]]", "[[EMAIL_STATEMENTS]]"],
        None,
        ["[[BUILDING_INSURER]]", "[[BUILDING_POLICY]]", "[[BUILDING_RENEWAL]]"],
        ["[[CONTENTS_INSURER]]", "[[CONTENTS_POLICY]]", "[[CONTENTS_RENEWAL]]"],
        ["[[LANDLORD_INSURER]]", "[[LANDLORD_POLICY]]", "[[LANDLORD_RENEWAL]]"],
        ["[[OTHER_INSTRUCTIONS]]"],
        ["[[PETS]]", "[[GROUPS]]"],
    ]

    for row_index, placeholders in enumerate(row_placeholders):
        if not placeholders or row_index >= len(rows):
            continue
        cells = rows[row_index].findall("w:tc", NS)
        for cell_index, placeholder in enumerate(placeholders):
            if cell_index >= len(cells):
                break
            cell = cells[cell_index]
            joined = "".join(node.text or "" for node in cell.findall(".//w:t", NS))
            if placeholder in joined:
                continue
            if "[[COMMENCEMENT]]" in joined or placeholder == "[[RENT_PW]]":
                ensure_placeholder_paragraph(cell, f"[[RENT_PW]]  At commencement [[COMMENCEMENT]]")
                continue
            if placeholder == "[[UNIT_PLAN_NO]]" and "Unit Plan" in joined:
                ensure_placeholder_paragraph(cell, "[[UNIT_PLAN_NO]]             [[UNIT_PLAN_MANAGER]]")
                continue
            if placeholder == "[[DIVISION]]" and "Division" in joined and "EER" in joined:
                ensure_placeholder_paragraph(cell, "[[DIVISION]]                                          [[EER]]")
                continue
            ensure_placeholder_paragraph(cell, placeholder)

    return ET.tostring(root, encoding="unicode")


def apply_string_replacements(xml: str) -> str:
    xml = re.sub(
        r"PROPERTY DETAILS:\s*AVAILABLE FROM.+?TO.+?\.\.",
        "PROPERTY DETAILS:              AVAILABLE FROM [[AVAILABLE_FROM]] TO [[AVAILABLE_TO]]",
        xml,
        count=1,
        flags=re.DOTALL,
    )
    replacements = [
        ("     Please specify ____________________________________________________________________________________", "     Please specify [[SPECIAL_INSTRUCTIONS]]"),
        ("13. Instruction books for appliances if applicable____________________________________________________________", "13. Instruction books for appliances if applicable [[INSTRUCTION_BOOKS]]"),
        ("Hot water System____________________________________________________________________________________", "Hot water System [[HOT_WATER_LOCATION]]"),
        ("Electrical meter box__________________________________________________________________________________", "Electrical meter box [[METER_BOX]]"),
        ("Water meter/Stopcock________________________________________________________________________________", "Water meter/Stopcock [[WATER_METER]]"),
        ("______________________________________________________________________________________________________", "[[ADDITIONAL_INFO]]"),
        ("_________________________________________", "[[OWNER_SIGNATURE]]"),
        (" _________________", " [[OWNER_SIG_DATE]]", 1),
        (" _________________________________________", "[[AGENT_SIGNATURE]]"),
        (" __________________", " [[AGENT_SIG_DATE]]"),
        ("Friend or Power of Attorney to contact in an emergency:", "Friend or Power of Attorney to contact in an emergency: [[EMERGENCY_CONTACT]]"),
        ("Phone W)", "Phone W) [[EMERGENCY_PHONE]]"),
        ("Do you intend to sell the property at the end of the fixed tenancy?", "Do you intend to sell the property at the end of the fixed tenancy? [[INTEND_SELL]]"),
        ("OWNER (sign): ", "OWNER (sign): [[OWNER_SIGN_NAME]] [[OWNER_SIGNATURE]]DATE: [[OWNER_SIG_DATE]]"),
        ("AGENT (sign): ", "AGENT (sign): [[AGENT_SIGN_NAME]] [[AGENT_SIGNATURE]]DATE: [[AGENT_SIG_DATE]]"),
    ]

    for item in replacements:
        if len(item) == 3:
            old, new, count = item
            xml = xml.replace(old, new, count)
        else:
            old, new = item
            xml = xml.replace(old, new)

    return xml


def main():
    if not SRC.exists():
        raise SystemExit(f"Missing source template: {SRC}")

    with zipfile.ZipFile(SRC, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    xml = merge_runs(files["word/document.xml"].decode("utf-8"))
    xml = inject_table_placeholders(xml)
    xml = apply_string_replacements(xml)
    files["word/document.xml"] = xml.encode("utf-8")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, data in files.items():
            zout.writestr(name, data)

    print("Wrote", OUT)
    try:
        shutil.copy2(OUT, PUBLIC_OUT)
        print("Wrote", PUBLIC_OUT)
    except PermissionError:
        print("Skipped public copy (file in use). Prepared template is at", OUT)


if __name__ == "__main__":
    main()
