"""Headless prop kit for Apex Peak and the B3 control desk.

  blender -b --python tools/build_set_props.py
"""
from __future__ import annotations

import os

import bpy
from mathutils import Vector

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "models"))


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def principled(name: str, color: tuple[float, float, float], roughness: float, metallic: float, emission=None, strength: float = 0.0):
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


def add_box(name: str, location, size, material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material)
    return obj


def add_cylinder(name: str, location, radius: float, depth: float, material, vertices: int = 16) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def join(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
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


def export(obj: bpy.types.Object, filename: str) -> None:
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
    print("wrote", path)


def build_chair() -> None:
    clear_scene()
    leather = principled("Leather", (0.045, 0.05, 0.06), 0.55, 0.0)
    metal = principled("ChairMetal", (0.55, 0.56, 0.58), 0.32, 0.85)
    parts = [
        add_box("Seat", (0, 0.02, 0.46), (0.56, 0.52, 0.08), leather),
        add_box("Back", (0, -0.22, 0.78), (0.52, 0.06, 0.5), leather),
        add_cylinder("Post", (0, 0, 0.24), 0.04, 0.36, metal),
        add_cylinder("Hub", (0, 0, 0.06), 0.05, 0.04, metal),
    ]
    for index, angle in enumerate((0, 72, 144, 216, 288)):
        import math
        rad = math.radians(angle)
        x = math.cos(rad) * 0.22
        y = math.sin(rad) * 0.22
        parts.append(add_cylinder(f"Spoke{index}", (x * 0.5, y * 0.5, 0.045), 0.015, 0.28, metal))
        spoke = parts[-1]
        spoke.rotation_euler[1] = math.radians(78)
        spoke.rotation_euler[2] = rad
        bpy.ops.object.transform_apply(rotation=True)
        parts.append(add_cylinder(f"Wheel{index}", (x, y, 0.03), 0.035, 0.03, metal, 12))
    export(join(parts, "OfficeChair"), "office-chair.glb")


def build_table() -> None:
    clear_scene()
    wood = principled("Oak", (0.42, 0.3, 0.18), 0.42, 0.0)
    metal = principled("TableMetal", (0.25, 0.26, 0.28), 0.4, 0.7)
    top = add_box("Top", (0, 0, 0.74), (10.2, 2.9, 0.08), wood)
    parts = [top]
    for x in (-4.6, 4.6):
        for y in (-1.05, 1.05):
            parts.append(add_box(f"Leg{x}{y}", (x, y, 0.36), (0.12, 0.12, 0.72), metal))
    parts.append(add_box("ApronX", (0, 0, 0.66), (9.4, 2.4, 0.06), wood))
    export(join(parts, "BoardTable"), "board-table.glb")


def build_desk() -> None:
    clear_scene()
    wood = principled("DeskOak", (0.4, 0.28, 0.16), 0.46, 0.0)
    dark = principled("DeskDark", (0.08, 0.08, 0.09), 0.5, 0.15)
    parts = [
        add_box("Top", (0, 0, 0.74), (2.3, 0.95, 0.06), wood),
        add_box("Modesty", (0, -0.42, 0.4), (2.1, 0.04, 0.62), dark),
        add_box("PedLeft", (-0.85, 0.05, 0.36), (0.42, 0.7, 0.7), dark),
        add_box("PedRight", (0.85, 0.05, 0.36), (0.42, 0.7, 0.7), dark),
    ]
    export(join(parts, "OfficeDesk"), "office-desk.glb")


def build_terminal() -> None:
    clear_scene()
    bezel = principled("Bezel", (0.04, 0.045, 0.05), 0.35, 0.4)
    screen = principled("Screen", (0.05, 0.2, 0.28), 0.25, 0.0, (0.15, 0.55, 0.7), 3.0)
    parts = [
        add_box("Panel", (0, 0, 0.34), (0.72, 0.04, 0.42), bezel),
        add_box("Glass", (0, 0.012, 0.34), (0.62, 0.01, 0.32), screen),
        add_box("Neck", (0, -0.02, 0.1), (0.08, 0.08, 0.16), bezel),
        add_box("Foot", (0, 0, 0.02), (0.28, 0.18, 0.03), bezel),
    ]
    export(join(parts, "OfficeTerminal"), "office-terminal.glb")


def build_troffer() -> None:
    clear_scene()
    housing = principled("Housing", (0.12, 0.12, 0.13), 0.45, 0.55)
    lamp = principled("Lamp", (0.85, 0.9, 0.95), 0.3, 0.0, (0.75, 0.85, 1.0), 4.0)
    parts = [
        add_box("Can", (0, 0, 0.04), (1.15, 0.42, 0.08), housing),
        add_box("Diffuser", (0, 0, 0.0), (1.0, 0.28, 0.015), lamp),
    ]
    export(join(parts, "Troffer"), "ceiling-troffer.glb")


def build_whiskey() -> None:
    clear_scene()
    glass = principled("Whiskey", (0.55, 0.32, 0.08), 0.12, 0.05, (0.35, 0.16, 0.02), 0.15)
    parts = [
        add_cylinder("Bowl", (0, 0, 0.06), 0.045, 0.09, glass, 20),
        add_cylinder("Foot", (0, 0, 0.008), 0.03, 0.012, glass, 16),
    ]
    export(join(parts, "Whiskey"), "whiskey-glass.glb")


def build_trophy() -> None:
    clear_scene()
    gold = principled("Gold", (0.72, 0.55, 0.2), 0.28, 1.0)
    dark = principled("Plinth", (0.08, 0.07, 0.06), 0.45, 0.2)
    parts = [
        add_box("Base", (0, 0, 0.04), (0.22, 0.22, 0.08), dark),
        add_cylinder("Cup", (0, 0, 0.22), 0.07, 0.22, gold, 20),
        add_cylinder("Stem", (0, 0, 0.1), 0.025, 0.08, gold, 12),
    ]
    export(join(parts, "Trophy"), "trophy.glb")


def build_console() -> None:
    clear_scene()
    steel = principled("ConsoleSteel", (0.16, 0.18, 0.17), 0.4, 0.65)
    screen = principled("ConsoleScreen", (0.02, 0.18, 0.1), 0.3, 0.0, (0.05, 0.7, 0.35), 2.4)
    parts = [
        add_box("Top", (0, 0, 0.92), (1.35, 3.8, 0.08), steel),
        add_box("Body", (0, 0, 0.44), (1.2, 3.6, 0.84), steel),
        add_box("Screen", (0.62, 0, 1.15), (0.04, 2.4, 0.42), screen),
    ]
    export(join(parts, "LabConsole"), "lab-console.glb")


if __name__ == "__main__":
    build_chair()
    build_table()
    build_desk()
    build_terminal()
    build_troffer()
    build_whiskey()
    build_trophy()
    build_console()
