"""B3 strata_rise, 9 s: liquidity is deposited layer by layer and the canyon narrows.

The land is the real NVDA/USDC PERP book (BASELINE), cut at 2026-11-08 19:30:25 UTC: the cut
face is the real depth profile at that moment (spread 107 bps, $500 of bids, $49,113 of asks).
The deposits are an illustration: each layer adds resting USD on both sides at a tighter
distance from mid, and its surface is the recomputed sqrt(cumulative depth), so the canyon
narrows exactly the way a deeper book would. The last layer is ochre: STRATA depth.

    blender -b -P infra/blender/film/shot_b3_strata_rise.py -- --mode anim
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b3_strata_rise"
FRAMES = 9 * S.FPS
CUT_Y = 42.0  # row 84: 19:30:25 UTC
X_DATA = 36.0
Y_END = 140.0

# Illustration: (USD added per side, distance from mid in bps). Bottom to top.
DEPOSITS = [(3000.0, 44.0), (6000.0, 34.0), (10000.0, 25.0), (5000.0, 15.0)]
LAND_FRAMES = [54, 102, 150, 204]  # frame each layer lands on
FALL_FRAMES = 20
FADE_FRAMES = 13
DROP_M = 6.5


def key_fall(ob: bpy.types.Object, land: int) -> None:
    start = land - FALL_FRAMES
    for fr in range(1, FRAMES + 1):
        if fr < start:
            z = DROP_M
        elif fr <= land:
            t = (fr - start) / FALL_FRAMES
            z = DROP_M * (1 - t * t)
        else:
            # Settle: a short damped compression after impact.
            dt = (fr - land) / S.FPS
            z = -0.07 * np.exp(-dt * 9.0) * np.sin(dt * 26.0)
        ob.location.z = z
        ob.keyframe_insert("location", index=2, frame=fr)
        hide = fr < start - 1
        ob.hide_render = hide
        ob.keyframe_insert("hide_render", frame=fr)
    for fc in S.fcurves(ob):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR" if fc.data_path == "location" else "CONSTANT"


def key_fade(mat: bpy.types.Material, land: int) -> None:
    node = mat.node_tree.nodes.get("fade")
    sock = node.outputs[0]
    start = land - FALL_FRAMES
    for fr, v in [(1, 0.0), (start, 0.0), (start + FADE_FRAMES, 1.0)]:
        sock.default_value = v
        sock.keyframe_insert("default_value", frame=fr)


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()

    xs = S.axis(-180, 180, (-40, 40), 0.12)
    ys = S.axis(CUT_Y, 420, (CUT_Y, Y_END), 0.12)
    rock = S.rock_material()
    top, walls, _ = S.build_land_block(f, xs, ys, name="land")
    top.data.materials.append(rock)
    walls.data.materials.append(rock)

    # Floor of the cut: bedrock at the base of the section, toward the camera.
    fx = S.axis(-180, 180, (-40, 40), 0.5, outer_n=30)
    fy = S.axis(-120, CUT_Y, (CUT_Y - 40, CUT_Y), 0.5, outer_n=30)
    FX, FY = np.meshgrid(fx, fy)
    FZ = S.BASE_Z + S.fbm(FX, FY, 0.2, 5, 77) * 0.12
    floor = S.grid_mesh("floor", FX, FY, FZ)
    floor.data.materials.append(S.rock_material("floor", contour_strength=0.8))

    layers = S.build_deposit_stack(f, DEPOSITS, CUT_Y, Y_END, x_max=X_DATA)
    for i, (mat, obs) in enumerate(layers):
        key_fade(mat, LAND_FRAMES[i])
        for ob in obs:
            key_fall(ob, LAND_FRAMES[i])

    # The STRATA stratum warms once it has landed.
    glow = S.ochre_layer_material().node_tree.nodes.get("body_glow")
    if glow:
        sock = glow.outputs[0]
        for fr, v in [(1, 0.0), (LAND_FRAMES[-1], 0.0), (LAND_FRAMES[-1] + 36, 0.09), (FRAMES, 0.11)]:
            sock.default_value = v
            sock.keyframe_insert("default_value", frame=fr)

    sun_az, sun_el = -100.0, 14.0
    S.setup_world(S.Sky(glow_strength=1.2), S.sun_direction(sun_az, sun_el))
    S.add_sun(sun_az, sun_el, strength=7.0, color_hex="#FFD6A8", angle_deg=2.5)
    S.add_haze(density=0.003, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 140.0, 0.0), color_hex="#AAB0AA")
    S.setup_render(samples=64, motion_blur=True, vol_tile="8", vol_samples=64)
    S.setup_compositor(bloom=0.07, vignette=0.25)

    cam = S.make_camera(lens=40.0, fstop=7.1)
    V = S.mathutils.Vector
    p_eye = [V((-12.5, CUT_Y - 40.0, 14.0)), V((-11.5, CUT_Y - 38.5, 13.7)), V((-10.0, CUT_Y - 36.5, 13.3)), V((-9.0, CUT_Y - 35.0, 13.0))]
    p_tgt = [V((0.8, CUT_Y + 16.0, 3.6)), V((0.7, CUT_Y + 15.5, 3.7)), V((0.6, CUT_Y + 15.0, 3.8)), V((0.5, CUT_Y + 14.5, 3.9))]
    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=lambda t: S.bezier(p_eye, S.ease_in_out(t)),
        target_at=lambda t: S.bezier(p_tgt, S.ease_in_out(t)),
        focus_at=lambda t: V((0.0, CUT_Y + 1.0, 1.0)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=240)
