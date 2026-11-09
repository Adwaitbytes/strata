"""B7 merkle_root, 6 s: score leaves grow into a single root, a quiet crystal formation.

The structure is the real tree of the first attested epoch (testnet, season 1, epoch 0,
19:22 to 20:22 UTC on 2026-11-08, postEpoch tx 0xc7133de9...d9d0a): three leaves, one per
agent. Following packages/sdk/src/merkle.ts, leaves 1 and 2 hash into a node, leaf 3 is odd
and is promoted unchanged, and that node plus leaf 3 hash into root 0x117a7ecd...6ada77.
The root is ochre. The crystals stand on the real BASELINE land, mesas behind.

    blender -b -P infra/blender/film/shot_b7_merkle_root.py -- --mode anim
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b7_merkle_root"
FRAMES = 6 * S.FPS
BASE = (-14.0, 30.0)  # on the bid bank, looking toward the canyon and the ask mesas


def _crystal(radius: float, height: float, tip: float, sides: int = 6):
    """One quartz-like prism: hexagonal body, pointed cap, short point below. Base at origin."""
    a = np.linspace(0, 2 * np.pi, sides, endpoint=False) + 0.3
    ring = np.stack([np.cos(a) * radius, np.sin(a) * radius], -1)
    verts = [(0.0, 0.0, -tip * 0.35)]
    verts += [(x, y, 0.0) for x, y in ring]
    verts += [(x * 0.92, y * 0.92, height) for x, y in ring]
    verts += [(0.0, 0.0, height + tip)]
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((0, 1 + j, 1 + i))
        faces.append((1 + i, 1 + j, 1 + sides + j, 1 + sides + i))
        faces.append((1 + sides + i, 1 + sides + j, 1 + 2 * sides))
    return verts, faces


def crystal_mesh(name: str, radius: float, height: float, tip: float, satellites: int = 3, seed: int = 0) -> bpy.types.Object:
    """A small cluster: one main crystal and a few smaller ones leaning out of its foot."""
    rng = np.random.default_rng(seed)
    verts: list = []
    faces: list = []
    parts = [(radius, height, tip, S.mathutils.Matrix.Identity(4))]
    for k in range(satellites):
        lean = math.radians(rng.uniform(16, 34))
        turn = 2 * math.pi * (k + rng.uniform(-0.2, 0.2)) / satellites
        sc = rng.uniform(0.38, 0.62)
        m = (
            S.mathutils.Matrix.Rotation(turn, 4, "Z")
            @ S.mathutils.Matrix.Translation((radius * 0.55, 0.0, -0.02))
            @ S.mathutils.Matrix.Rotation(lean, 4, "Y")
        )
        parts.append((radius * sc, height * sc, tip * sc, m))
    for r, h, t, m in parts:
        v, fc = _crystal(r, h, t)
        off = len(verts)
        verts += [tuple(m @ S.mathutils.Vector(p)) for p in v]
        faces += [tuple(i + off for i in f) for f in fc]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def crystal_material(name: str, base_hex: str, glow_hex: str | None = None) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = S.NB(nt)
    tc = b.node("ShaderNodeTexCoord")
    n = b.noise(tc.outputs["Object"], 3.0, detail=4)
    col = b.ramp(n, [(0.3, S.mixc(S.hexc(base_hex), S.hexc("#0D0F0E"), 0.4)), (0.8, S.hexc(base_hex))])
    bsdf = b.node("ShaderNodeBsdfPrincipled")
    b.set(bsdf.inputs["Base Color"], col)
    bsdf.inputs["Roughness"].default_value = 0.18
    bsdf.inputs["Specular IOR Level"].default_value = 0.7
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.05
    g = b.value(0.0, "glow")
    if glow_hex:
        bsdf.inputs["Emission Color"].default_value = S.hexc(glow_hex)
        # Light from inside, like citrine: brightest where you look through a face, with fine
        # veins, darker toward the silhouette, so it reads as mineral rather than a lamp.
        lw = b.node("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.35
        through = b.math("POWER", b.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 2.0)
        veins = b.smooth(b.noise(tc.outputs["Object"], 22.0, detail=4, rough=0.6), 0.6, 0.72)
        inner = b.math("ADD", b.math("MULTIPLY", through, 0.8), b.math("MULTIPLY", veins, 0.5))
        b.set(bsdf.inputs["Emission Strength"], b.math("MULTIPLY", g, b.math("ADD", 0.12, inner)))
    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def filament_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("filament")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = S.NB(nt)
    em = b.node("ShaderNodeEmission")
    em.inputs["Color"].default_value = S.mixc(S.hexc(S.PAL["chalk"]), S.hexc(S.PAL["ochre"]), 0.3)
    em.inputs["Strength"].default_value = 0.7
    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Surface"], em.outputs[0])
    return mat


def filament(name: str, a: S.mathutils.Vector, c: S.mathutils.Vector, mat, grow: tuple[int, int]) -> None:
    """A thin rod from a to c that grows out of a over the frame range."""
    length = (c - a).length
    me = bpy.data.meshes.new(name)
    sides = 8
    r = 0.0065
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    verts = [(math.cos(t) * r, math.sin(t) * r, 0.0) for t in ang] + [(math.cos(t) * r, math.sin(t) * r, 1.0) for t in ang]
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    ob.location = a
    ob.rotation_euler = (c - a).to_track_quat("Z", "Y").to_euler()
    for fr in range(1, FRAMES + 1):
        t = S.ease_in_out((fr - grow[0]) / (grow[1] - grow[0]))
        ob.scale = (1.0, 1.0, max(length * t, 1e-4))
        ob.keyframe_insert("scale", frame=fr)
        ob.hide_render = fr < grow[0]
        ob.keyframe_insert("hide_render", frame=fr)


def key_form(ob: bpy.types.Object, start: int, dur: int, rise: float = 0.0) -> None:
    """Crystal forms: scales up with a slight overshoot and turns a few degrees as it settles."""
    base = ob.location.copy()
    for fr in range(1, FRAMES + 1):
        t = min(max((fr - start) / dur, 0.0), 1.0)
        c1, c3 = 1.70158, 2.70158
        s = 0.0 if t <= 0 else 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
        ob.scale = (max(s, 1e-4),) * 3
        ob.location = base + S.mathutils.Vector((0, 0, -rise * (1 - S.ease_out(t))))
        ob.rotation_euler = (0.0, 0.0, math.radians(18.0 * (1 - S.ease_out(t))))
        for path in ("scale", "location", "rotation_euler"):
            ob.keyframe_insert(path, frame=fr)
        ob.hide_render = fr < start
        ob.keyframe_insert("hide_render", frame=fr)


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    xs = S.axis(-180, 180, (-44, 44), 0.1)
    ys = S.axis(-60, 420, (0, 120), 0.1)
    X, Y = np.meshgrid(xs, ys)
    Z = S.terrain_heights(f, X, Y)
    land = S.grid_mesh("terrain", X, Y, Z)
    land.data.materials.append(S.rock_material(joints_on=False))

    gz = float(S.terrain_heights(f, np.array([[BASE[0], BASE[0] + 0.1], [BASE[0], BASE[0] + 0.1]]), np.array([[BASE[1], BASE[1]], [BASE[1] + 0.1, BASE[1] + 0.1]]))[0, 0])
    V = S.mathutils.Vector
    o = V((BASE[0], BASE[1], gz))
    # Leaves along a gentle arc, node above leaves 1 and 2, root above node and leaf 3.
    leaf = [o + V((-1.5, 0.3, 0.0)), o + V((-0.4, -0.2, 0.0)), o + V((1.6, 0.1, 0.0))]
    node = o + V((-0.95, 0.05, 1.55))
    root = o + V((0.25, 0.05, 3.1))

    dark = crystal_material("leaf", "#5A6862")
    mid = crystal_material("node", "#72807A")
    ochre = crystal_material("root", "#8A5E26", glow_hex=S.PAL["ochre"])
    fil = filament_material()

    leaf_h = 0.55
    for i, p in enumerate(leaf):
        ob = crystal_mesh(f"leaf_{i + 1}", 0.13, leaf_h, 0.16, satellites=2, seed=i + 1)
        ob.location = p
        ob.data.materials.append(dark)
        key_form(ob, 10 + i * 9, 20, rise=0.25)
    nob = crystal_mesh("node_12", 0.17, 0.7, 0.2, satellites=3, seed=12)
    nob.location = node
    nob.data.materials.append(mid)
    rob = crystal_mesh("root", 0.24, 1.0, 0.3, satellites=4, seed=99)
    rob.location = root
    rob.data.materials.append(ochre)

    tip = V((0, 0, leaf_h + 0.16))
    filament("f_l1_n", leaf[0] + tip, node + V((0, 0, -0.07)), fil, (44, 64))
    filament("f_l2_n", leaf[1] + tip, node + V((0, 0, -0.07)), fil, (46, 66))
    key_form(nob, 64, 18)
    filament("f_n_r", node + V((0, 0, 0.9)), root + V((0, 0, -0.1)), fil, (88, 110))
    filament("f_l3_r", leaf[2] + tip, root + V((0, 0, -0.1)), fil, (90, 114))
    key_form(rob, 112, 20)
    g = ochre.node_tree.nodes["glow"].outputs[0]
    for fr, v in [(1, 0.0), (120, 0.0), (150, 0.9), (FRAMES, 1.0)]:
        g.default_value = v
        g.keyframe_insert("default_value", frame=fr)

    sun_az, sun_el = -55.0, 12.0
    S.setup_world(S.Sky(glow_strength=1.3), S.sun_direction(sun_az, sun_el))
    S.add_sun(sun_az, sun_el, strength=6.5, color_hex="#FFD3A0", angle_deg=2.5)
    S.add_haze(density=0.004, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 140.0, 0.0), color_hex="#AAB0AA")
    S.setup_render(samples=40)
    S.setup_compositor(bloom=0.12, vignette=0.28)

    cam = S.make_camera(lens=35.0, fstop=2.8)
    target = o + V((0.1, 0.0, 2.05))

    def eye(t: float):
        a = math.radians(-118.0 + 14.0 * S.ease_in_out(0.1 + 0.8 * t))
        r = 10.2 - 1.2 * S.ease_in_out(t)
        return o + V((r * math.cos(a), r * math.sin(a), 1.5 + 0.4 * t))

    S.key_camera_path(cam, FRAMES, eye_at=eye, target_at=lambda t: target, focus_at=lambda t: o + V((0.0, 0.0, 1.5)))


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=170)
