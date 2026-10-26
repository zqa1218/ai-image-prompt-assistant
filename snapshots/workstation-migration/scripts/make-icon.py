#!/usr/bin/env python3
"""生成应用图标 assets/icon.ico。

纯几何绘制：圆角方块 + 对角渐变 + 四角星。小尺寸下依然清晰，
比放一张位图更适合做桌面快捷方式图标。

用法：python scripts/make-icon.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
OUT = Path(__file__).resolve().parent.parent / "assets" / "icon.ico"
PREVIEW = Path(__file__).resolve().parent.parent / "assets" / "icon-preview.png"

COLOR_FROM = (79, 70, 229)   # indigo-600
COLOR_TO = (147, 51, 234)    # purple-600
CORNER_RATIO = 0.22


def gradient(size: int) -> Image.Image:
    """对角线性渐变。"""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(
                round(COLOR_FROM[i] + (COLOR_TO[i] - COLOR_FROM[i]) * t) for i in range(3)
            )
    return image


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    return mask


def sparkle(draw: ImageDraw.ImageDraw, cx: float, cy: float, outer: float, inner_ratio=0.3):
    """四角星：四个长尖 + 四个短内点。"""
    inner = outer * inner_ratio
    points = []
    for index in range(8):
        angle = math.pi / 4 * index - math.pi / 2
        radius = outer if index % 2 == 0 else inner
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    draw.polygon(points, fill=(255, 255, 255, 255))


def build() -> Image.Image:
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base.paste(gradient(SIZE), (0, 0), rounded_mask(SIZE, round(SIZE * CORNER_RATIO)))

    draw = ImageDraw.Draw(base)
    # 主星略偏左下，右上留出一颗小星，避免视觉居中呆板
    sparkle(draw, SIZE * 0.44, SIZE * 0.50, SIZE * 0.30)
    sparkle(draw, SIZE * 0.73, SIZE * 0.27, SIZE * 0.12)
    return base


def main() -> int:
    icon = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(
        OUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    icon.resize((128, 128), Image.LANCZOS).save(PREVIEW)
    print(f"[OK] 已生成 {OUT}（{OUT.stat().st_size} 字节）")
    print(f"     预览图 {PREVIEW}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
