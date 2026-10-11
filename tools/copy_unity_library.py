"""Copy indexed Unity models, textures, and audio into phoriginsassets.

Reads library/catalog.json. Copies each file once, under models/unity,
textures/unity, and audio/unity so existing game files stay put.
Rewrites the catalog to the new paths. Does not delete the Unity project.

  python tools/copy_unity_library.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

CATALOG = Path(r"C:\Projects\phoriginsassets\library\catalog.json")
INDEX = Path(r"C:\Projects\phoriginsassets\library\index.txt")
UNITY = Path(r"C:\Projects\SGFD\Assets")
ROOTS = {
    "model": Path(r"C:\Projects\phoriginsassets\models\unity"),
    "collider": Path(r"C:\Projects\phoriginsassets\models\unity"),
    "animation": Path(r"C:\Projects\phoriginsassets\models\unity"),
    "audio": Path(r"C:\Projects\phoriginsassets\audio\unity"),
    "texture": Path(r"C:\Projects\phoriginsassets\textures\unity"),
}


def relocate(src: Path, kind: str) -> Path:
    root = ROOTS[kind]
    try:
        rel = src.resolve().relative_to(UNITY.resolve())
    except ValueError:
        return src
    return root / rel


def copy_file(src: Path, dest: Path) -> None:
    if not src.is_file():
        raise FileNotFoundError(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size == src.stat().st_size:
        return
    shutil.copy2(src, dest)


def write_index(models: list[dict], audio: list[dict]) -> None:
    lines = []
    for item in models + audio:
        texture_bits = []
        for slot in item.get("slots", []):
            parts = [f"{role}={path}" for role, path in slot.get("textures", {}).items()]
            texture_bits.append(f"{slot['material']}: {', '.join(parts)}" if parts else slot["material"])
        lines.append("\t".join([
            item["name"],
            item["pack"],
            item["kind"],
            ",".join(item.get("aliases", [])),
            item["file"],
            " | ".join(texture_bits),
        ]))
    INDEX.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    copied = {"model": 0, "texture": 0, "audio": 0}
    missing = 0
    seen: set[str] = set()

    def take(path_str: str, kind: str) -> str:
        nonlocal missing
        src = Path(path_str)
        dest = relocate(src, kind)
        key = str(dest).lower()
        if key in seen:
            return str(dest)
        seen.add(key)
        if not src.is_file():
            missing += 1
            return path_str
        copy_file(src, dest)
        copied[kind if kind != "collider" and kind != "animation" else "model"] += 1
        return str(dest)

    for item in catalog["models"]:
        item["file"] = take(item["file"], item["kind"])
        for slot in item.get("slots", []):
            textures = slot.get("textures", {})
            for role, texture in list(textures.items()):
                textures[role] = take(texture, "texture")
    for item in catalog["audio"]:
        item["file"] = take(item["file"], "audio")

    catalog["note"] = "Files live under phoriginsassets models/unity, textures/unity, and audio/unity."
    CATALOG.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    write_index(catalog["models"], catalog["audio"])
    print(f"models {copied['model']}")
    print(f"textures {copied['texture']}")
    print(f"audio {copied['audio']}")
    print(f"missing {missing}")


if __name__ == "__main__":
    main()
