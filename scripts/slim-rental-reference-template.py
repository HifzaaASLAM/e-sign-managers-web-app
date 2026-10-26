"""Strip embedded fonts from rental-reference DOCX so Make webhooks stay under size limits."""
from __future__ import annotations

import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "lib", "shm", "templates", "rental-reference-form-template.docx")
PUB = os.path.join(ROOT, "public", "shm-plugin-assets", "templates", "rental-reference-form-template.docx")

MINIMAL_FONT_TABLE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:fonts>'
)


def slim_docx(path: str) -> None:
    bak = path + ".bak-with-fonts"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
        print("backed up", bak)

    tmp = path + ".tmp"
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = info.filename
            data = zin.read(name)

            if name.startswith("word/fonts/"):
                print("drop", name, info.file_size)
                continue
            if name == "word/_rels/fontTable.xml.rels":
                continue
            if name == "word/fontTable.xml":
                data = MINIMAL_FONT_TABLE.encode("utf-8")
            elif name == "word/_rels/document.xml.rels":
                text = data.decode("utf-8")
                text = re.sub(r"<Relationship[^>]*fonts/[^>]*/?>", "", text)
                text = re.sub(r'<Relationship[^>]*Type="[^"]*fontTable[^"]*"[^/]*/>', "", text, flags=re.I)
                data = text.encode("utf-8")
            elif name == "[Content_Types].xml":
                text = data.decode("utf-8")
                text = re.sub(r"<Override[^>]*fontTable\.xml\"[^/]*/>", "", text)
                text = re.sub(r'<Default Extension="odttf"[^/]*/>', "", text)
                data = text.encode("utf-8")
            elif name == "word/settings.xml":
                text = data.decode("utf-8")
                text = re.sub(r"<[^>]*embedTrueTypeFonts[^/]*/>", "", text)
                text = re.sub(r"<[^>]*saveSubsetFonts[^/]*/>", "", text)
                data = text.encode("utf-8")

            zout.writestr(name, data)

    os.replace(tmp, path)
    print("new size", os.path.getsize(path), path)


def main() -> None:
    slim_docx(SRC)
    os.makedirs(os.path.dirname(PUB), exist_ok=True)
    shutil.copy2(SRC, PUB)
    print("copied", PUB, os.path.getsize(PUB))


if __name__ == "__main__":
    main()
