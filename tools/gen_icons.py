#!/usr/bin/env python3
"""生成占位图标（不依赖 ImageMagick）。

用法：python3 tools/gen_icons.py
输出：icons/icon16.png、icon48.png、icon128.png
"""

import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

# 自绘配色，避免使用 GitHub 官方品牌色与标识
BG = (24, 39, 66, 255)
FG = (255, 255, 255, 240)


def make_icon(size: int) -> Image.Image:
    scale = 8  # 先放大绘制再缩小，边缘更干净
    s = size * scale
    img = Image.new("RGBA", (s, s), BG)
    d = ImageDraw.Draw(img)

    pad = int(s * 0.18)
    radius = int(s * 0.18)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=radius, outline=FG, width=max(scale, int(s * 0.055)))

    stroke = max(scale, int(s * 0.075))
    d.line(
        [(s * 0.30, s * 0.53), (s * 0.44, s * 0.67)],
        fill=FG,
        width=stroke,
        joint="curve",
    )
    d.line(
        [(s * 0.44, s * 0.67), (s * 0.72, s * 0.33)],
        fill=FG,
        width=stroke,
        joint="curve",
    )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        make_icon(size).save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
