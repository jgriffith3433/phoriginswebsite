"""Flatten albedo lighting and write a normal plus a roughness map.

Run from the repo root:
  python tools/derive_maps.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / "assets" / "textures"
PROBE = TEX / "probe"

SOURCES = [
    "office-wall.webp",
    "office-plaster.webp",
    "office-floor.webp",
    "ceil-tile.webp",
    "hall-floor.webp",
    "lift-metal.webp",
    "office-desk.webp",
    "office-chair.webp",
    "wired-glass.webp",
]

ROUGHNESS = {
    "office-wall.webp": 0.92,
    "office-plaster.webp": 0.84,
    "office-floor.webp": 0.46,
    "ceil-tile.webp": 0.58,
    "hall-floor.webp": 0.38,
    "lift-metal.webp": 0.34,
    "office-desk.webp": 0.5,
    "office-chair.webp": 0.62,
    "wired-glass.webp": 0.18,
}


def flatten(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    blur = rgb.filter(ImageFilter.GaussianBlur(radius=48))
    src = list(rgb.getdata())
    low = list(blur.getdata())
    out = []
    for (r, g, b), (lr, lg, lb) in zip(src, low):
        def lift(channel: int, base: int) -> int:
            mixed = channel * 0.72 + (channel / max(base, 18)) * 255 * 0.28
            return max(0, min(255, int(mixed)))
        out.append((lift(r, lr), lift(g, lg), lift(b, lb)))
    flat = Image.new("RGB", rgb.size)
    flat.putdata(out)
    return flat


def normal_map(image: Image.Image) -> Image.Image:
    gray = image.convert("L")
    edges_x = gray.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale=1, offset=128))
    # DirectX green (down). Kernel is inverted relative to OpenGL so Babylon's default matches.
    edges_y = gray.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale=1, offset=128))
    width, height = gray.size
    normal = Image.new("RGB", (width, height))
    px = normal.load()
    xs = edges_x.load()
    ys = edges_y.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = (xs[x, y], ys[x, y], 255)
    return normal


def roughness_map(image: Image.Image, bias: float) -> Image.Image:
    detail = ImageOps.autocontrast(image.convert("L").filter(ImageFilter.FIND_EDGES))
    mid = int(max(0, min(255, bias * 255)))
    return Image.blend(Image.new("L", image.size, mid), detail, 0.35).convert("RGB")


def write_probe(name: str, rgb: tuple[int, int, int]) -> None:
    PROBE.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (16, 16), rgb)
    for face in ("px", "py", "pz", "nx", "ny", "nz"):
        image.save(PROBE / f"{name}_{face}.webp", "WEBP", quality=80)


def main() -> None:
    for name in SOURCES:
        path = TEX / name
        if not path.exists():
            print("skip", name)
            continue
        image = Image.open(path)
        stem = path.stem
        flat = flatten(image)
        flat.save(TEX / f"{stem}-flat.webp", "WEBP", quality=82)
        normal_map(flat).save(TEX / f"{stem}-n.webp", "WEBP", quality=82)
        roughness_map(flat, ROUGHNESS[name]).save(TEX / f"{stem}-r.webp", "WEBP", quality=78)
        print("maps", stem)

    write_probe("office", (58, 68, 82))
    write_probe("lab", (28, 52, 42))

    materials_path = TEX / "materials.json"
    catalog = json.loads(materials_path.read_text(encoding="utf-8"))
    for mat in catalog.get("materials", []):
        albedo = str(mat.get("albedo", ""))
        stem = Path(albedo).stem
        flat = TEX / f"{stem}-flat.webp"
        normal = TEX / f"{stem}-n.webp"
        rough = TEX / f"{stem}-r.webp"
        if flat.exists():
            mat["albedo"] = f"/assets/textures/{flat.name}"
        if normal.exists():
            mat["normal"] = f"/assets/textures/{normal.name}"
        if rough.exists():
            mat["roughnessMap"] = f"/assets/textures/{rough.name}"
        source_name = f"{stem}.webp" if not stem.endswith("-flat") else ""
        if stem.endswith("-flat"):
            source_name = stem[: -len("-flat")] + ".webp"
        if source_name in ROUGHNESS:
            mat["roughness"] = ROUGHNESS[source_name]
    materials_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print("materials updated")


if __name__ == "__main__":
    main()
