"""Make SHM creator signature PNG: transparent background, dark ink for Word."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def boost_existing_png(src: Path, dest: Path) -> None:
    """Re-darken an already-processed transparent signature PNG."""
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
            lum = (r + g + b) / 3
            if lum > 200 and a < 80:
                px[x, y] = (0, 0, 0, 0)
                continue
            strength = min(255, int(a * 1.35 + (255 - lum) * 0.45))
            px[x, y] = (0, 0, 0, min(255, strength + 40))
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, format="PNG", optimize=True)


def _corner_luminance(px, w: int, h: int) -> float:
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    total = 0.0
    for x, y in pts:
        r, g, b, _a = px[x, y]
        total += (r + g + b) / 3
    return total / len(pts)


def process(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    light_on_dark = _corner_luminance(px, w, h) < 85

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            lum = (r + g + b) / 3
            if light_on_dark:
                if lum < 42:
                    px[x, y] = (0, 0, 0, 0)
                    continue
                ink_alpha = min(255, max(0, int((lum - 38) * 1.05)))
                px[x, y] = (0, 0, 0, ink_alpha)
                continue
            if lum < 40:
                px[x, y] = (0, 0, 0, 0)
                continue
            if lum > 215:
                px[x, y] = (0, 0, 0, 0)
                continue
            strength = min(255, int((215 - lum) * 2.2))
            alpha = min(255, strength + 90)
            px[x, y] = (0, 0, 0, alpha)

    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    pad = 12
    canvas = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(im, (pad, pad), im)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, format="PNG", compress_level=1)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    args = sys.argv[1:]
    if args and args[0] == "--boost-existing":
        out_dir = root / "public" / "shm-plugin-assets" / "images"
        for name in ("creator-auto-signature.png", "pma-default-agent-signature.png"):
            path = out_dir / name
            if path.is_file():
                boost_existing_png(path, path)
                print("Boosted", path)
        return
    src = Path(args[0]) if args else None
    if not src or not src.is_file():
        raise SystemExit("Usage: process-creator-signature.py <source.png> | --boost-existing")
    out_dir = root / "public" / "shm-plugin-assets" / "images"
    import shutil

    for original_name in (
        "creator-auto-signature-original.png",
        "pma-default-agent-signature-original.png",
    ):
        dest = out_dir / original_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print("Wrote original (unchanged)", dest)
    for name in (
        "creator-auto-signature-word-embed.png",
        "pma-default-agent-signature-word-embed.png",
        "creator-auto-signature.png",
        "pma-default-agent-signature.png",
    ):
        process(src, out_dir / name)
        print("Wrote word-ready embed", out_dir / name)


if __name__ == "__main__":
    main()
