"""B1 terrain_open, 8 s: a slow dusk glide over the real NVDA/USDC PERP book (BASELINE).

The camera flies forward in time along the canyon (the spread). Bids rest on the low bank to
the left, the $49k ask wall stands as mesas on the right wherever it was on the book.

    blender -b -P infra/blender/film/shot_b1_terrain_open.py -- --mode anim
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b1_terrain_open"
FRAMES = 8 * S.FPS


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    xs = S.axis(-180, 180, (-44, 44), 0.12)
    ys = S.axis(-60, 420, (-8, 128), 0.12)
    X, Y = np.meshgrid(xs, ys)
    Z = S.terrain_heights(f, X, Y)
    land = S.grid_mesh("terrain", X, Y, Z)
    land.data.materials.append(S.rock_material())

    sun_az, sun_el = -38.0, 9.0
    S.setup_world(S.Sky(strength=1.0, glow_strength=1.4), S.sun_direction(sun_az, sun_el))
    S.add_sun(sun_az, sun_el, strength=8.0, color_hex="#FFD9B0", angle_deg=3.0)
    S.add_haze(density=0.004, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 120.0, 0.0), color_hex="#AAB0AA")
    S.setup_render()
    S.setup_compositor(bloom=0.06, vignette=0.25)

    cam = S.make_camera(lens=32.0, fstop=5.6)
    p_eye = [S.mathutils.Vector(v) for v in [(-7.0, 2.0, 8.6), (-5.5, 7.0, 8.0), (-3.5, 12.0, 7.2), (-2.0, 17.0, 6.8)]]
    p_tgt = [S.mathutils.Vector(v) for v in [(3.0, 58.0, -2.0), (3.5, 64.0, -1.5), (4.0, 70.0, -1.2), (4.5, 76.0, -1.0)]]
    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=lambda t: S.bezier(p_eye, S.ease_in_out(0.12 + 0.76 * t) * 1.0),
        target_at=lambda t: S.bezier(p_tgt, S.ease_in_out(0.12 + 0.76 * t)),
        focus_at=lambda t: S.bezier(p_eye, S.ease_in_out(0.12 + 0.76 * t)) + S.mathutils.Vector((3.0, 34.0, -6.0)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=120)
