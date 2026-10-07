#!/usr/bin/env python3
"""Procedural 512px night-city cube faces (no HDR). Run: python tools/generate-night-city-skybox.py"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
HORIZON = int(SIZE * 0.58)
OUT = Path(__file__).resolve().parents[1] / "assets" / "textures" / "skybox"


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c0: tuple[int, int, int], c1: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(lerp(c0[0], c1[0], t)),
        int(lerp(c0[1], c1[1], t)),
        int(lerp(c0[2], c1[2], t)),
    )


def put(px, x: int, y: int, color: tuple[int, int, int], w: int, h: int) -> None:
    if 0 <= x < w and 0 <= y < h:
        px[x, y] = color


def paint_sky(img: Image.Image, moon: bool) -> None:
    px = img.load()
    w, h = img.size
    zenith = (4, 8, 18)
    haze = (18, 28, 48)
    for y in range(h):
        t = y / max(1, HORIZON)
        row = mix(zenith, haze, t ** 1.15) if y <= HORIZON else mix(haze, (8, 10, 16), (y - HORIZON) / max(1, h - HORIZON))
        for x in range(w):
            px[x, y] = row
    rng = random.Random(11)
    for _ in range(90):
        x = rng.randrange(w)
        y = rng.randrange(max(8, HORIZON - 40))
        b = rng.randint(140, 230)
        put(px, x, y, (b, b, min(255, b + 20)), w, h)
    if moon:
        cx, cy, r = int(w * 0.18), int(h * 0.16), 16
        draw = ImageDraw.Draw(img)
        draw.ellipse((cx - r * 3, cy - r * 3, cx + r * 3, cy + r * 3), fill=(28, 36, 58))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(214, 222, 236))


def draw_building(draw: ImageDraw.ImageDraw, px, x0: int, y0: int, bw: int, bh: int, seed: int, w: int, h: int) -> None:
    rng = random.Random(seed)
    body = (6 + rng.randint(0, 10), 8 + rng.randint(0, 10), 14 + rng.randint(0, 12))
    x1, y1 = x0 + bw, y0 + bh
    draw.rectangle((x0, y0, x1, y1), fill=body)
    # lit windows
    pad = 2
    cell_w, cell_h = 3, 4
    gy = y0 + pad + rng.randint(0, 2)
    while gy + cell_h < y1 - 2:
        gx = x0 + pad + rng.randint(0, 1)
        while gx + cell_w < x1 - 1:
            if rng.random() > 0.38:
                warm = rng.random() < 0.55
                color = (220, 200, 140) if warm else (160, 190, 220)
                if rng.random() < 0.08:
                    color = (255, 170, 90)
                draw.rectangle((gx, gy, gx + cell_w - 1, gy + cell_h - 2), fill=color)
            gx += cell_w + 1
        gy += cell_h + 1
    # roof edge
    draw.line((x0, y0, x1, y0), fill=(20, 24, 32))
    if rng.random() < 0.25:
        spire_x = (x0 + x1) // 2
        draw.line((spire_x, y0 - rng.randint(8, 22), spire_x, y0), fill=(40, 50, 70))
        put(px, spire_x, y0 - 1, (220, 80, 70), w, h)


def paint_city_strip(img: Image.Image, seed: int) -> None:
    rng = random.Random(seed)
    draw = ImageDraw.Draw(img)
    px = img.load()
    w, h = img.size
    ground_y = h - 1
    # far haze band
    for y in range(HORIZON - 6, HORIZON + 18):
        t = (y - (HORIZON - 6)) / 24
        row = mix((22, 32, 52), (10, 12, 18), t)
        for x in range(w):
            cur = px[x, y]
            px[x, y] = mix(cur, row, 0.35)

    layers = [
        (0.35, 18, 42, seed + 1),
        (0.55, 22, 70, seed + 2),
        (0.85, 16, 110, seed + 3),
    ]
    for density, min_w, max_h, layer_seed in layers:
        lr = random.Random(layer_seed)
        x = -lr.randint(0, 20)
        while x < w:
            bw = lr.randint(min_w, min_w + 28)
            bh = int(max_h * (0.35 + lr.random() * 0.65) * density)
            y0 = HORIZON - bh + lr.randint(-4, 8)
            y0 = max(20, min(y0, HORIZON - 8))
            draw_building(draw, px, x, y0, bw, ground_y - y0, lr.randint(0, 10_000), w, h)
            x += bw + lr.randint(1, 7)

    # street glow
    for x in range(w):
        if rng.random() < 0.04:
            put(px, x, h - 3, (255, 190, 90), w, h)
            put(px, x, h - 2, (180, 120, 40), w, h)


def paint_down(img: Image.Image) -> None:
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            n = (math.sin(x * 0.08) * math.cos(y * 0.07) + 1) * 0.5
            base = int(6 + n * 8)
            px[x, y] = (base, base + 1, base + 6)
    rng = random.Random(99)
    draw = ImageDraw.Draw(img)
    for _ in range(40):
        x0 = rng.randint(0, w - 1)
        y0 = rng.randint(0, h - 1)
        x1 = x0 + rng.choice([-1, 1]) * rng.randint(40, 180)
        y1 = y0 + rng.choice([-1, 1]) * rng.randint(40, 180)
        draw.line((x0, y0, x1, y1), fill=(40, 48, 28), width=1)
    for _ in range(180):
        x = rng.randrange(w)
        y = rng.randrange(h)
        if rng.random() < 0.7:
            put(px, x, y, (220, 180, 90), w, h)
        else:
            put(px, x, y, (90, 140, 200), w, h)


def slice_faces(pano: Image.Image) -> dict[str, Image.Image]:
    # pano is 4*SIZE x SIZE: +Z, +X, -Z, -X (left → right)
    order = ["pz", "px", "nz", "nx"]
    faces = {}
    for i, name in enumerate(order):
        faces[name] = pano.crop((i * SIZE, 0, (i + 1) * SIZE, SIZE))
    return faces


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pano = Image.new("RGB", (SIZE * 4, SIZE))
    paint_sky(pano, moon=True)
    paint_city_strip(pano, seed=2026)
    pano = pano.filter(ImageFilter.GaussianBlur(radius=0.45))

    faces = slice_faces(pano)
    py = Image.new("RGB", (SIZE, SIZE))
    paint_sky(py, moon=False)
    # city glow on zenith edges so cube seams are less sharp
    px = py.load()
    for y in range(SIZE - 48, SIZE):
        t = (y - (SIZE - 48)) / 48
        for x in range(SIZE):
            px[x, y] = mix(px[x, y], (16, 22, 36), t * 0.55)
    faces["py"] = py

    ny = Image.new("RGB", (SIZE, SIZE))
    paint_down(ny)
    faces["ny"] = ny.filter(ImageFilter.GaussianBlur(radius=0.6))

    for name, im in faces.items():
        png_path = OUT / f"night-city_{name}.png"
        im.save(png_path, "PNG")
        print(png_path)


if __name__ == "__main__":
    main()
