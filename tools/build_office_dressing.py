"""Office dressing for Apex Peak. Headless:

  blender -b --python tools/build_office_dressing.py

Front face is Blender +Y, which glTF stores as -Z. Level yaw 0 faces -Z.
"""
from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "assets", "models")
BLEND = os.path.join(os.path.dirname(ROOT), "phoriginsassets", "models", "office-dressing.blend")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def principled(name, color, roughness, metallic, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    node.inputs["Base Color"].default_value = (*color, 1.0)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    if emission is not None:
        key = "Emission Color" if "Emission Color" in node.inputs else "Emission"
        node.inputs[key].default_value = (*emission, 1.0)
        if "Emission Strength" in node.inputs:
            node.inputs["Emission Strength"].default_value = strength
    return material


def add_box(name, location, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    return obj


def add_cylinder(name, location, radius, depth, material, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_cone(name, location, radius, depth, material, vertices=8):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, depth=depth, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_ico(name, location, radius, material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_z = min(corner.z for corner in corners)
    center_x = sum(corner.x for corner in corners) / len(corners)
    center_y = sum(corner.y for corner in corners) / len(corners)
    obj.location.x -= center_x
    obj.location.y -= center_y
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True)
    return obj


def export(obj, filename):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    dims = tuple(round(value, 3) for value in obj.dimensions)
    print("wrote", path, "blender_xyz", dims)


def finish(parts, name, filename, slot):
    obj = join(parts, name)
    export(obj, filename)
    obj.location.x = slot * 5
    return obj


def build_cooler(slot):
    body = principled("CoolerBody", (0.82, 0.84, 0.86), 0.38, 0.15)
    dark = principled("CoolerDark", (0.08, 0.09, 0.1), 0.45, 0.4)
    water = principled("CoolerWater", (0.15, 0.42, 0.72), 0.15, 0.05, (0.1, 0.35, 0.7), 0.8)
    parts = [
        add_box("Base", (0, 0, 0.04), (0.38, 0.38, 0.08), dark),
        add_box("Body", (0, 0, 0.48), (0.36, 0.34, 0.78), body),
        add_box("Tap", (0, 0.18, 0.42), (0.06, 0.06, 0.04), dark),
        add_cylinder("Bottle", (0, 0, 1.02), 0.11, 0.32, water, 12),
        add_cylinder("Neck", (0, 0, 1.2), 0.045, 0.06, water, 10),
    ]
    return finish(parts, "WaterCooler", "water-cooler.glb", slot)


def build_cabinet(slot):
    shell = principled("CabShell", (0.16, 0.17, 0.18), 0.42, 0.35)
    metal = principled("CabHandle", (0.62, 0.64, 0.66), 0.28, 0.9)
    parts = [
        add_box("Shell", (0, 0, 0.66), (0.46, 0.58, 1.28), shell),
    ]
    for index, z in enumerate((0.28, 0.66, 1.04)):
        parts.append(add_box(f"Pull{index}", (0.1, 0.3, z), (0.14, 0.02, 0.02), metal))
    return finish(parts, "FilingCabinet", "filing-cabinet.glb", slot)


def build_plant(slot):
    pot = principled("Pot", (0.22, 0.2, 0.18), 0.55, 0.05)
    soil = principled("Soil", (0.08, 0.06, 0.04), 0.9, 0.0)
    leaf = principled("Leaf", (0.08, 0.22, 0.1), 0.62, 0.0)
    parts = [
        add_cylinder("Pot", (0, 0, 0.16), 0.16, 0.28, pot, 10),
        add_cylinder("Soil", (0, 0, 0.3), 0.13, 0.04, soil, 10),
        add_cone("FrondA", (0, 0, 0.72), 0.22, 0.7, leaf, 7),
        add_ico("PuffA", (0.12, 0.05, 0.85), 0.16, leaf),
        add_ico("PuffB", (-0.1, -0.04, 0.95), 0.14, leaf),
        add_ico("PuffC", (0.02, 0.12, 0.7), 0.12, leaf),
    ]
    return finish(parts, "OfficePlant", "office-plant.glb", slot)


def build_door(slot):
    frame = principled("DoorFrame", (0.14, 0.14, 0.15), 0.4, 0.25)
    slab = principled("DoorSlab", (0.34, 0.24, 0.14), 0.48, 0.0)
    glass = principled("DoorLite", (0.55, 0.7, 0.78), 0.12, 0.0, (0.35, 0.55, 0.7), 0.35)
    metal = principled("DoorHandle", (0.7, 0.72, 0.74), 0.22, 0.95)
    plate = principled("DoorPlate", (0.05, 0.08, 0.1), 0.35, 0.2, (0.2, 0.55, 0.7), 1.2)
    parts = [
        add_box("JambL", (-0.48, 0, 1.05), (0.08, 0.14, 2.1), frame),
        add_box("JambR", (0.48, 0, 1.05), (0.08, 0.14, 2.1), frame),
        add_box("Head", (0, 0, 2.06), (1.04, 0.14, 0.08), frame),
        add_box("Slab", (0, 0.01, 1.02), (0.86, 0.05, 1.96), slab),
        add_box("Lite", (0, 0.04, 1.45), (0.28, 0.02, 0.7), glass),
        add_box("Handle", (0.28, 0.06, 1.0), (0.12, 0.04, 0.03), metal),
        add_box("Plate", (0, 0.05, 1.85), (0.16, 0.015, 0.05), plate),
    ]
    return finish(parts, "OfficeDoor", "office-door.glb", slot)


def build_bin(slot):
    shell = principled("Bin", (0.1, 0.11, 0.12), 0.5, 0.2)
    rim = principled("BinRim", (0.45, 0.46, 0.48), 0.3, 0.7)
    parts = [
        add_cylinder("Can", (0, 0, 0.22), 0.14, 0.4, shell, 12),
        add_cylinder("Rim", (0, 0, 0.42), 0.15, 0.03, rim, 12),
    ]
    return finish(parts, "WasteBin", "waste-bin.glb", slot)


def build_credenza(slot):
    wood = principled("CredOak", (0.55, 0.42, 0.26), 0.46, 0.0)
    dark = principled("CredDark", (0.1, 0.1, 0.11), 0.5, 0.2)
    metal = principled("CredPull", (0.62, 0.64, 0.66), 0.28, 0.85)
    parts = [
        add_box("Top", (0, 0, 0.74), (1.6, 0.46, 0.05), wood),
        add_box("Body", (0, 0, 0.36), (1.52, 0.42, 0.68), dark),
        add_box("PullL", (-0.4, 0.22, 0.4), (0.16, 0.02, 0.02), metal),
        add_box("PullR", (0.4, 0.22, 0.4), (0.16, 0.02, 0.02), metal),
    ]
    return finish(parts, "Credenza", "credenza.glb", slot)


def build_runner(slot):
    pile = principled("Carpet", (0.16, 0.2, 0.26), 0.92, 0.0)
    edge = principled("CarpetEdge", (0.1, 0.12, 0.16), 0.9, 0.0)
    parts = [
        add_box("Pile", (0, 0, 0.006), (1, 1, 0.012), pile),
        add_box("Edge", (0, 0, 0.004), (1.08, 1.08, 0.006), edge),
    ]
    return finish(parts, "CarpetRunner", "carpet-runner.glb", slot)


def build_clutter(slot):
    paper = principled("Paper", (0.82, 0.8, 0.74), 0.7, 0.0)
    mug = principled("Mug", (0.15, 0.22, 0.28), 0.35, 0.1)
    parts = [
        add_box("Stack", (-0.08, 0, 0.015), (0.24, 0.18, 0.03), paper),
        add_cylinder("Mug", (0.12, 0.02, 0.04), 0.035, 0.07, mug, 10),
    ]
    return finish(parts, "DeskClutter", "desk-clutter.glb", slot)


def build_directory(slot):
    frame = principled("DirFrame", (0.12, 0.12, 0.13), 0.4, 0.3)
    face = principled("DirFace", (0.08, 0.16, 0.22), 0.3, 0.1, (0.15, 0.45, 0.62), 1.4)
    parts = [
        add_box("Frame", (0, 0, 1.45), (0.7, 0.04, 0.9), frame),
        add_box("Face", (0, 0.025, 1.45), (0.58, 0.015, 0.74), face),
    ]
    return finish(parts, "Directory", "directory-board.glb", slot)


if __name__ == "__main__":
    clear_scene()
    build_cooler(0)
    build_cabinet(1)
    build_plant(2)
    build_door(3)
    build_bin(4)
    build_credenza(5)
    build_runner(6)
    build_clutter(7)
    build_directory(8)
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("saved", BLEND)
