#!/usr/bin/env python3
"""Deterministic local post-processing for generated backdrops.

Raw generations stay untouched in art/raw/backgrounds. This writes the web-sized
assets the game loads, and slightly knocks back contrast/saturation on the
battlefield plates so tinted squad sprites stay readable on top of them.
"""
from pathlib import Path
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "art/raw/backgrounds"
OUT = ROOT / "assets/backgrounds"
OUT.mkdir(parents=True, exist_ok=True)

BATTLE_SIZE = (1280, 720)
MAP_SIZE = (1280, 854)


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (resized.width - tw) // 2
    top = (resized.height - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def write(name: str, size: tuple[int, int], saturation: float, brightness: float) -> None:
    src = RAW / f"{name}-1.png"
    if not src.exists():
        print(f"MISSING {src}")
        return
    img = cover(Image.open(src).convert("RGB"), size)
    img = ImageEnhance.Color(img).enhance(saturation)
    img = ImageEnhance.Brightness(img).enhance(brightness)
    dst = OUT / f"{name}.jpg"
    img.save(dst, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"{dst.relative_to(ROOT)} {img.width}x{img.height} {dst.stat().st_size // 1024}KB")


for biome in ("plains", "forest", "mountain", "swamp", "ruins"):
    # Muted and a touch darker: sprites and their team tints read over the plate.
    write(biome, BATTLE_SIZE, 0.82, 0.86)

# The map is UI furniture rather than a backdrop, so keep it closer to the original.
write("worldmap", MAP_SIZE, 0.95, 0.95)
