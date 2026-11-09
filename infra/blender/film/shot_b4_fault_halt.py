"""B4 fault_halt, 5 s: a fault cracks across the land, the far side drops, and everything stops.

Land: the real NVDA/USDC PERP book (BASELINE). The fault is an illustration of a guard halt:
a hairline of halt red runs across the land, the far side drops a step and every moving
thing (camera, dust) holds still for the rest of the shot.

    blender -b -P infra/blender/film/shot_b4_fault_halt.py -- --mode anim
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b4_fault_halt"
FRAMES = 5 * S.FPS
FAULT_Y = 93.0
CRACK = (34, 56)  # hairline runs across the land over these frames
DROP = (56, 61)  # far side drops
FREEZE = 61  # nothing moves after this frame
DROP_Z = -0.8
GAP_Y = 0.22
X_LO, X_HI = -180.0, 180.0


def fault_line(x: np.ndarray) -> np.ndarray:
    """Jagged, not random-looking: two scales of wander plus a few kinks."""
    return FAULT_Y + S.fbm(x, np.zeros_like(x), 0.05, 3, 41) * 3.0 + S.fbm(x, np.ones_like(x), 0.7, 3, 42) * 0.35


def patch(x: np.ndarray, fy: np.ndarray, offsets: np.ndarray, sign: float):
    """Rows at fixed offsets from the fault (fine near it), so one edge follows the fault."""
    X = np.repeat(x[None, :], len(offsets), axis=0)
    Y = fy[None, :] + sign * offsets[:, None]
    if sign < 0:
        X, Y = X[::-1], Y[::-1]
    return X, Y


def crack_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("fault")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = S.NB(nt)
    att = b.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="u")
    prog = b.value(0.0, "progress")
    u = att.outputs["Fac"]
    lit = b.smooth(b.math("SUBTRACT", prog, u), -0.004, 0.004)
    tip = b.math("MULTIPLY", b.smooth(b.math("ABSOLUTE", b.math("SUBTRACT", prog, u)), 0.04, 0.0), b.math("LESS_THAN", prog, 0.999))
    gain = b.value(1.0, "gain")
    strength = b.math("MULTIPLY", b.math("ADD", b.math("MULTIPLY", lit, 3.0), b.math("MULTIPLY", tip, 14.0)), gain)
    em = b.node("ShaderNodeEmission")
    em.inputs["Color"].default_value = S.hexc(S.PAL["halt"])
    b.set(em.inputs["Strength"], strength)
    tr = b.node("ShaderNodeBsdfTransparent")
    mix = b.node("ShaderNodeMixShader")
    b.set(mix.inputs[0], b.math("MAXIMUM", lit, tip))
    b.set(mix.inputs[1], tr.outputs[0])
    b.set(mix.inputs[2], em.outputs[0])
    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Surface"], mix.outputs[0])
    return mat


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    rock = S.rock_material()

    xs = S.axis(X_LO, X_HI, (-44, 44), 0.12)
    fy = fault_line(xs)
    # Intact land until the crack starts, so no seam shows before the fault exists.
    Xi, Yi = np.meshgrid(xs, S.axis(-60, 420, (40, 140), 0.12))
    Zi = S.terrain_heights(f, Xi, Yi)
    intact = S.grid_mesh("intact", Xi, Yi, Zi)
    intact.data.materials.append(rock)
    split_parts: list = []

    # Near land, ending on the fault.
    Xn, Yn = patch(xs, fy, S.axis(0.0, 155.0, (0.0, 45.0), 0.12, outer_n=60), -1.0)
    Zn = S.terrain_heights(f, Xn, Yn)
    split_parts += [S.grid_mesh("near_top", Xn, Yn, Zn), S.walls_mesh("near_walls", Xn, Yn, Zn, S.BASE_Z)]
    # Far land, starting on the fault. It drops as one block.
    Xf, Yf = patch(xs, fy, S.axis(0.0, 330.0, (0.0, 52.0), 0.12, outer_n=80), 1.0)
    Zf = S.terrain_heights(f, Xf, Yf)
    far = [S.grid_mesh("far_top", Xf, Yf, Zf), S.walls_mesh("far_walls", Xf, Yf, Zf, S.BASE_Z)]
    split_parts += far
    for ob in split_parts:
        ob.data.materials.append(rock)
    for fr in range(1, FRAMES + 1):
        whole = fr < CRACK[0]
        intact.hide_render = not whole
        intact.keyframe_insert("hide_render", frame=fr)
        for ob in split_parts:
            ob.hide_render = whole
            ob.keyframe_insert("hide_render", frame=fr)
    for ob in far:
        for fr in range(1, FRAMES + 1):
            t = S.ease_out((fr - DROP[0]) / (DROP[1] - DROP[0]))
            ob.location = (0.0, GAP_Y * t, DROP_Z * t)
            ob.keyframe_insert("location", frame=fr)

    # The hairline: a ribbon on the near edge of the fault, lit from left to right.
    zr = Zn[-1, :] + 0.02
    ribbon_v = np.concatenate([np.stack([xs, fy - 0.03, zr], -1), np.stack([xs, fy + 0.05, zr], -1)])
    n = len(xs)
    q = np.stack([np.arange(n - 1), np.arange(1, n), np.arange(1, n) + n, np.arange(n - 1) + n], -1)
    ribbon = S.mesh_from_arrays("fault_ribbon", ribbon_v.astype(np.float32), q.astype(np.int32))
    uu = np.clip((xs - (-50.0)) / 100.0, 0, 1)
    att = ribbon.data.attributes.new("u", "FLOAT", "POINT")
    att.data.foreach_set("value", np.concatenate([uu, uu]).astype(np.float32))
    cm = crack_material()
    ribbon.data.materials.append(cm)
    # A glowing floor inside the gap once it opens.
    deep_v = np.concatenate([np.stack([xs, fy + 0.0, zr - 0.6], -1), np.stack([xs, fy + GAP_Y, zr - 0.6], -1)])
    deep = S.mesh_from_arrays("fault_deep", deep_v.astype(np.float32), q.astype(np.int32))
    att = deep.data.attributes.new("u", "FLOAT", "POINT")
    att.data.foreach_set("value", np.concatenate([uu, uu]).astype(np.float32))
    deep.data.materials.append(cm)
    nodes = cm.node_tree.nodes
    for fr, v in [(1, 0.0), (CRACK[0], 0.0), (CRACK[1], 1.0)]:
        nodes["progress"].outputs[0].default_value = v
        nodes["progress"].outputs[0].keyframe_insert("default_value", frame=fr)
    for fr, v in [(1, 1.0), (DROP[0], 1.0), (FREEZE, 0.55)]:
        nodes["gain"].outputs[0].default_value = v
        nodes["gain"].outputs[0].keyframe_insert("default_value", frame=fr)
    for fc in S.fcurves(cm.node_tree):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

    # Motes on the evening air, and a kick of grit that follows the crack front up out of the
    # fault. Both hold still at the freeze.
    S.add_dust(
        900,
        center=(0.0, 86.0, 3.5),
        size=(46.0, 34.0, 7.0),
        frames=FRAMES,
        freeze_frame=FREEZE,
        drift=(0.5, 0.25, 0.08),
        radius=(0.006, 0.018),
        material=S.dust_material("#B8A98E", glow=0.12),
    )
    rng = np.random.default_rng(9)
    kx = rng.uniform(-50.0, 50.0, 2600)
    ky = np.interp(kx, xs, fy) + rng.normal(0.0, 0.18, kx.size)
    kz = np.interp(kx, xs, zr) + rng.uniform(-0.1, 0.25, kx.size)
    S.add_dust(
        0,
        center=(0, 0, 0),
        size=(1, 1, 1),
        frames=FRAMES,
        freeze_frame=FREEZE,
        start_frame=CRACK[0],
        drift=(0.0, -0.15, 1.1),
        wobble=0.5,
        radius=(0.008, 0.03),
        seed=11,
        points=np.stack([kx, ky, kz], -1),
        sweep=(-50.0, 50.0, (CRACK[1] - CRACK[0]) / S.FPS),
        grow=6.0,
        material=S.dust_material("#A99A80", glow=0.08),
    )

    sun_az, sun_el = -48.0, 8.0
    S.setup_world(S.Sky(), S.sun_direction(sun_az, sun_el))
    S.add_sun(sun_az, sun_el, strength=7.5, color_hex="#FFD3A0", angle_deg=2.5)
    S.add_haze(density=0.0035, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 140.0, 0.0), color_hex="#AAB0AA")
    S.setup_render(samples=40, motion_blur=True)
    S.setup_compositor(bloom=0.08, vignette=0.26)

    cam = S.make_camera(lens=35.0, fstop=4.5)
    V = S.mathutils.Vector
    e0, e1 = V((-10.0, 72.0, 5.8)), V((-8.2, 74.8, 5.5))
    t0, t1 = V((5.0, 99.0, 0.0)), V((5.6, 99.6, 0.0))

    def drift(t: float) -> float:
        # Constant drift, then a dead stop at the freeze frame.
        fr = 1 + t * (FRAMES - 1)
        return min(fr, FREEZE) / FREEZE

    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=lambda t: e0.lerp(e1, drift(t)),
        target_at=lambda t: t0.lerp(t1, drift(t)),
        focus_at=lambda t: V((0.0, FAULT_Y, 0.5)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=110)
