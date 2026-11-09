"""B2 canyon_cut, 7 s: the camera descends, the land splits, and the cut face shows the real
depth profile of NVDA/USDC PERP (BASELINE) at 2026-11-08 19:30:25 UTC.

The far block's cut face is the book at that moment: bids on the left (a $500 bank, malachite
tinted beds), the 107 bps spread as the canyon, asks on the right (the $49,113 wall, oxide
tinted beds). The near block slides back and sinks to open the section.

    blender -b -P infra/blender/film/shot_b2_canyon_cut.py -- --mode anim
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b2_canyon_cut"
FRAMES = 7 * S.FPS
CUT_Y = 42.0  # row 84: 19:30:25 UTC, same cut as B3
SPLIT = (24, 150)  # frames over which the near block moves away
SLIDE = (-30.0, -8.5)  # metres in y and z


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    rock = S.rock_material()

    xs = S.axis(-180, 180, (-40, 40), 0.12)
    far_ys = S.axis(CUT_Y, 420, (CUT_Y, 140), 0.12)
    for ob in S.build_land_block(f, xs, far_ys, name="far")[:2]:
        ob.data.materials.append(rock)
    near_ys = S.axis(-160, CUT_Y, (-10, CUT_Y), 0.12)
    near = S.build_land_block(f, xs, near_ys, name="near")[:2]
    for ob in near:
        ob.data.materials.append(rock)
        for fr in range(1, FRAMES + 1):
            t = S.ease_in_out((fr - SPLIT[0]) / (SPLIT[1] - SPLIT[0]))
            ob.location = (0.0, SLIDE[0] * t, SLIDE[1] * t * t)
            ob.keyframe_insert("location", frame=fr)

    # Bedrock floor revealed under the gap.
    fx = S.axis(-180, 180, (-40, 40), 0.5, outer_n=30)
    fy = S.axis(-200, CUT_Y, (CUT_Y - 60, CUT_Y), 0.5, outer_n=30)
    FX, FY = np.meshgrid(fx, fy)
    floor = S.grid_mesh("floor", FX, FY, S.BASE_Z - 0.02 + S.fbm(FX, FY, 0.2, 5, 77) * 0.1)
    floor.data.materials.append(S.rock_material("floor", contour_strength=0.8))

    sun_az, sun_el = -100.0, 14.0
    S.setup_world(S.Sky(glow_strength=1.2), S.sun_direction(sun_az, sun_el))
    S.add_sun(sun_az, sun_el, strength=7.0, color_hex="#FFD6A8", angle_deg=2.5)
    S.add_haze(density=0.003, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 140.0, 0.0), color_hex="#AAB0AA")
    S.setup_render(motion_blur=True)
    S.setup_compositor(bloom=0.07, vignette=0.25)

    cam = S.make_camera(lens=35.0, fstop=6.3)
    V = S.mathutils.Vector
    # High over the intact land, then down into the opening gap, square to the section.
    p_eye = [V((-3.0, 4.0, 46.0)), V((-4.0, 10.0, 30.0)), V((-3.0, 16.0, 10.0)), V((-1.2, 19.5, 3.4))]
    p_tgt = [V((1.0, 46.0, 0.0)), V((1.0, 50.0, 0.0)), V((0.6, 54.0, 1.0)), V((0.4, 60.0, 1.9))]
    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=lambda t: S.bezier(p_eye, S.ease_in_out(t)),
        target_at=lambda t: S.bezier(p_tgt, S.ease_in_out(t)),
        focus_at=lambda t: V((0.0, CUT_Y, 0.5)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=200)
