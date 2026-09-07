"""Regenerate web/ icons + favicon from a simple drawn glyph (no source asset).
Requires Pillow: pip install pillow
"""
import pathlib
from PIL import Image, ImageDraw

WEB = pathlib.Path(__file__).parents[1] / "web"
BRAND = (15, 76, 129)  # 0xFF0F4C81


def base(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 0 if maskable else int(size * 0.08)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.18), fill=BRAND)
    # simple mortar-board triangle
    m = size * 0.5
    d.polygon([(m, size * 0.30), (size * 0.78, size * 0.44), (m, size * 0.58), (size * 0.22, size * 0.44)],
              fill=(255, 255, 255, 255))
    return img


for name, size, maskable in [
    ("icons/Icon-192.png", 192, False), ("icons/Icon-512.png", 512, False),
    ("icons/Icon-maskable-192.png", 192, True), ("icons/Icon-maskable-512.png", 512, True),
]:
    base(size, maskable).save(WEB / name)
base(64, False).save(WEB / "favicon.png")
print("icons regenerated")
