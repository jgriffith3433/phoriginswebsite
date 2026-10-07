import base64
import json
import math
import os
import struct

root = r"c:\Projects\phoriginswebsite"
model_dir = os.path.join(root, "assets", "models")
audio_dir = os.path.join(root, "assets", "audio")
tex_dir = os.path.join(root, "assets", "textures")
for directory in [model_dir, audio_dir, tex_dir]:
    os.makedirs(directory, exist_ok=True)


def pad4(data: bytes) -> bytes:
    remainder = len(data) % 4
    if remainder:
        return data + (b"\x00" * (4 - remainder))
    return data


def write_wav(path: str, duration: float = 1.5, sample_rate: int = 22050, freq: float = 220.0) -> None:
    total_samples = int(sample_rate * duration)
    data = bytearray()
    for i in range(total_samples):
        t = i / sample_rate
        wave = 0.3 * math.sin(2 * math.pi * freq * t) + 0.15 * math.sin(2 * math.pi * (freq * 1.5) * t)
        sample = max(-1.0, min(1.0, wave))
        pcm = int(sample * 32767)
        data.extend(struct.pack("<h", pcm))

    with open(path, "wb") as fh:
        fh.write(b"RIFF")
        fh.write(struct.pack("<I", 36 + len(data)))
        fh.write(b"WAVE")
        fh.write(b"fmt ")
        fh.write(struct.pack("<I", 16))
        fh.write(struct.pack("<H", 1))
        fh.write(struct.pack("<H", 1))
        fh.write(struct.pack("<I", sample_rate))
        fh.write(struct.pack("<I", sample_rate * 2))
        fh.write(struct.pack("<H", 2))
        fh.write(struct.pack("<H", 16))
        fh.write(b"data")
        fh.write(struct.pack("<I", len(data)))
        fh.write(data)


def build_glb(vertices, normals, indices, out_path: str) -> None:
    position_data = struct.pack("<" + "f" * (len(vertices) * 3), *[coord for point in vertices for coord in point])
    normal_data = struct.pack("<" + "f" * (len(normals) * 3), *[coord for point in normals for coord in point])
    index_data = struct.pack("<" + "H" * len(indices), *indices)

    position_padded = pad4(position_data)
    normal_padded = pad4(normal_data)
    index_padded = pad4(index_data)

    buffer_data = position_padded + normal_padded + index_padded
    pos_offset = 0
    normal_offset = len(position_padded)
    index_offset = normal_offset + len(normal_padded)

    json_object = {
        "asset": {"version": "2.0", "generator": "PH Origins Asset Generator"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }],
        "buffers": [{"byteLength": len(buffer_data)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(position_padded), "target": 34962},
            {"buffer": 0, "byteOffset": normal_offset, "byteLength": len(normal_padded), "target": 34962},
            {"buffer": 0, "byteOffset": index_offset, "byteLength": len(index_padded), "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(vertices),
                "type": "VEC3",
                "min": [min(point[i] for point in vertices) for i in range(3)],
                "max": [max(point[i] for point in vertices) for i in range(3)],
            },
            {"bufferView": 1, "componentType": 5126, "count": len(normals), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }

    json_bytes = json.dumps(json_object, separators=(",", ":")).encode("utf-8")
    json_padded = pad4(json_bytes)
    buffer_padded = pad4(buffer_data)
    total_length = 12 + 8 + len(json_padded) + 8 + len(buffer_padded)

    with open(out_path, "wb") as fh:
        fh.write(struct.pack("<I", 0x46546C67))
        fh.write(struct.pack("<I", 2))
        fh.write(struct.pack("<I", total_length))
        fh.write(struct.pack("<I", len(json_padded)))
        fh.write(struct.pack("<I", 0x4E534F4A))
        fh.write(json_padded)
        fh.write(struct.pack("<I", len(buffer_padded)))
        fh.write(struct.pack("<I", 0x004E4942))
        fh.write(buffer_padded)


# Create a tiny but valid GLB for each model.
model_specs = [
    (
        "hero",
        [(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.0, 0.5, 0.0)],
        [(0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0)],
        [0, 1, 2],
    ),
    (
        "rock-cluster",
        [(-0.6, -0.4, 0.2), (0.5, -0.5, 0.1), (0.1, 0.7, -0.1), (-0.2, 0.3, -0.4)],
        [(0.0, 0.0, 1.0)] * 4,
        [0, 1, 2, 0, 2, 3],
    ),
    (
        "lantern-light",
        [(-0.4, -0.4, 0.0), (0.4, -0.4, 0.0), (0.2, 0.4, 0.0), (-0.2, 0.4, 0.0)],
        [(0.0, 0.0, 1.0)] * 4,
        [0, 1, 2, 0, 2, 3],
    ),
]

for name, vertices, normals, indices in model_specs:
    build_glb(vertices, normals, indices, os.path.join(model_dir, f"{name}.glb"))

write_wav(os.path.join(audio_dir, "neon-drift.wav"), duration=1.5, sample_rate=22050, freq=220.0)

png_data = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF" \
    "c0nyAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJ0UkGAAAAA" \
    "NAAAAAAB4LqAAAAA4uV3hAAABTklEQVR4jI3Qw9kAABgBIgAABwAAABJRU5ErkJggg=="
)
with open(os.path.join(tex_dir, "wood-floor.png"), "wb") as fh:
    fh.write(png_data)

print("Created real asset files in assets/")
for path in [
    os.path.join(audio_dir, "neon-drift.wav"),
    os.path.join(tex_dir, "wood-floor.png"),
    os.path.join(model_dir, "hero.glb"),
    os.path.join(model_dir, "rock-cluster.glb"),
    os.path.join(model_dir, "lantern-light.glb"),
]:
    print(path)
