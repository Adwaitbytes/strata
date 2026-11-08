"""
STRATA hero asset: "liquidity strata" base geometry, material and poster.

Run headless from the repo root:
    blender -b -P infra/blender/strata_hero.py

Outputs (apps/web/public/models/):
    strata_hero.glb          glTF 2.0, Draco geometry, no textures (so no KTX2 step is needed)
    strata_hero_poster.webp  neutral-state render (transparent) for the reduced-motion / low-FPS poster
    strata_hero_poster.avif  same poster, AVIF
The full-resolution PNG master is written to infra/blender/build/ (gitignored); the web
variants are encoded with cwebp and ImageMagick when they are on PATH.

Each stratum is authored at unit thickness (1.0 along Y after glTF Y-up conversion) with its
base at y = 0, so the web client sets layer thickness from live depth by scaling Y alone.
The terrain relief uses Blender's deterministic Perlin noise, so re-runs produce identical geometry.
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys

import bmesh
import bpy
from mathutils import Vector, noise

LAYER_COUNT = 7
RINGS = 22                # concentric rings on the top face; keeps the Draco file small
SEGMENTS = 96             # vertices around the rim
HALF_X = 1.5              # footprint half-extents (metres): a wide plinth, not a cube
HALF_Y = 1.05
SQUARENESS = 7.0          # superellipse exponent: higher is squarer corners
RELIEF = 0.06             # top-face terrain amplitude in unit-thickness space


INK = (0.0021, 0.0025, 0.0034, 1.0)        # #07080B in linear space
GLASS = (0.62, 0.86, 0.88, 1.0)            # cool translucent base tint, recoloured per layer on the web

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO, "apps", "web", "public", "models")
BUILD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build")


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def superellipse(theta: float) -> tuple[float, float]:
    """Point on a rounded-rectangle contour (superellipse), half-extents HALF_X by HALF_Y."""
    c, s = math.cos(theta), math.sin(theta)
    x = HALF_X * math.copysign(abs(c) ** (2 / SQUARENESS), c)
    y = HALF_Y * math.copysign(abs(s) ** (2 / SQUARENESS), s)
    return x, y


def terrain_height(x: float, y: float, layer: int) -> float:
    p = Vector((x * 1.2 + layer * 3.1, y * 1.2 - layer * 1.7, layer * 0.37))
    return noise.fractal(p, 0.55, 2.1, 4, noise_basis="PERLIN_ORIGINAL") * RELIEF


def build_stratum(index: int, material: bpy.types.Material) -> bpy.types.Object:
    """One slab: superellipse footprint, flat base at z=0, gently displaced top near z=1.

    Topology is concentric rings around a centre vertex, so the rim is a clean curve
    rather than a stair-stepped grid boundary.
    """
    bm = bmesh.new()
    top_rings: list[list[bmesh.types.BMVert]] = []
    bot_rings: list[list[bmesh.types.BMVert]] = []
    for r in range(1, RINGS + 1):
        t = r / RINGS
        # Relief fades to zero at the rim so side walls stay a clean cut.
        fade = min(1.0, (1.0 - t) / 0.12) if t > 0.88 else 1.0
        top_ring: list[bmesh.types.BMVert] = []
        bot_ring: list[bmesh.types.BMVert] = []
        for k in range(SEGMENTS):
            x, y = superellipse(2 * math.pi * k / SEGMENTS)
            x, y = x * t, y * t
            top_ring.append(bm.verts.new((x, y, 1.0 + terrain_height(x, y, index) * fade)))
            bot_ring.append(bm.verts.new((x, y, 0.0)))
        top_rings.append(top_ring)
        bot_rings.append(bot_ring)

    top_c = bm.verts.new((0.0, 0.0, 1.0 + terrain_height(0.0, 0.0, index)))
    bot_c = bm.verts.new((0.0, 0.0, 0.0))
    for k in range(SEGMENTS):
        n = (k + 1) % SEGMENTS
        bm.faces.new((top_c, top_rings[0][k], top_rings[0][n]))
        bm.faces.new((bot_c, bot_rings[0][n], bot_rings[0][k]))
        for r in range(RINGS - 1):
            a, b = top_rings[r], top_rings[r + 1]
            bm.faces.new((a[k], b[k], b[n], a[n]))
            a, b = bot_rings[r], bot_rings[r + 1]
            bm.faces.new((a[n], b[n], b[k], a[k]))
        # Side wall, split into a few bands so the normals light it evenly.
        t_out, b_out = top_rings[-1], bot_rings[-1]
        bm.faces.new((b_out[k], b_out[n], t_out[n], t_out[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(f"Stratum_{index:02d}")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(material)
    # Smooth terrain and rim curve, crisp edge where the top meets the wall.
    mesh.set_sharp_from_angle(angle=math.radians(50))

    obj = bpy.data.objects.new(f"Stratum_{index:02d}", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("StrataGlass")
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    assert bsdf is not None, "Principled BSDF node missing"
    bsdf.inputs["Base Color"].default_value = GLASS
    bsdf.inputs["Roughness"].default_value = 0.22
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Transmission Weight"].default_value = 0.92
    bsdf.inputs["Coat Weight"].default_value = 0.35
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    return mat


def stack_for_poster(objs: list[bpy.types.Object]) -> None:
    """Neutral state: equal thickness, even gaps. Mirrors the web client's neutral layout."""
    thickness = 0.11
    gap = 0.075
    z = 0.0
    for obj in objs:
        obj.scale = (1.0, 1.0, thickness)
        obj.location = (0.0, 0.0, z)
        z += thickness + gap
    for obj in objs:
        obj.location.z -= z / 2


def add_light(name: str, loc: tuple[float, float, float], energy: float, size: float, color: tuple[float, float, float]) -> None:
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    light.location = loc
    direction = Vector((0, 0, 0)) - Vector(loc)
    light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(light)


def render_poster(path: str) -> None:
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Ink")
    bg = world.node_tree.nodes.get("Background")
    assert bg is not None
    bg.inputs["Color"].default_value = INK
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    add_light("Key", (3.2, -2.6, 3.4), 420.0, 2.5, (0.78, 0.98, 1.0))
    add_light("Rim", (-3.0, 2.8, 1.6), 260.0, 3.0, (0.35, 0.95, 0.88))
    add_light("Fill", (0.0, -4.0, -0.6), 60.0, 4.0, (0.85, 0.88, 0.95))

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 52
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (4.6, -4.2, 2.1)
    cam.rotation_euler = (Vector((0, 0, -0.12)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = 6.6
    cam_data.dof.aperture_fstop = 2.8

    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_raytracing = True
    scene.eevee.taa_render_samples = 96
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.film_transparent = True  # poster sits on either theme background
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def encode_poster(master: str) -> None:
    webp = os.path.join(OUT_DIR, "strata_hero_poster.webp")
    avif = os.path.join(OUT_DIR, "strata_hero_poster.avif")
    if shutil.which("cwebp"):
        subprocess.run(["cwebp", "-quiet", "-q", "78", "-alpha_q", "85", "-resize", "1200", "0", master, "-o", webp], check=True)
    else:
        print("cwebp not found: encode", master, "to", webp, "manually")
    if shutil.which("magick"):
        subprocess.run(["magick", master, "-resize", "1200x", "-quality", "55", avif], check=True)
    else:
        print("ImageMagick not found: encode", master, "to", avif, "manually")


def export_glb(path: str, objs: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.scale = (1.0, 1.0, 1.0)
        obj.location = (0.0, 0.0, 0.0)
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=10,
        export_draco_position_quantization=12,
        export_draco_normal_quantization=9,
    )


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)
    reset_scene()
    material = build_material()
    layers = [build_stratum(i, material) for i in range(LAYER_COUNT)]

    stack_for_poster(layers)
    master = os.path.join(BUILD_DIR, "strata_hero_poster.png")
    render_poster(master)
    encode_poster(master)

    export_glb(os.path.join(OUT_DIR, "strata_hero.glb"), layers)
    print("STRATA_HERO_OK", OUT_DIR)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # surface a non-zero exit so CI and scripts notice failures
        print(f"STRATA_HERO_FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
