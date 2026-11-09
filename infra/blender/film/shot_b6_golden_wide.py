"""B6 golden_wide, 10 s: the filled land at golden hour, a slow orbit, sky kept clear for the title.

The land is the real NVDA/USDC PERP book (BASELINE). The deposits on it are the same
illustration as B3 (depth added at 44, 34, 25 and 15 bps from mid), so the canyon is narrowed
along the whole recording and the ochre STRATA stratum runs along both crests.

    blender -b -P infra/blender/film/shot_b6_golden_wide.py -- --mode anim
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import strata_scene as S  # noqa: E402

SHOT = "b6_golden_wide"
FRAMES = 10 * S.FPS
DEPOSITS = [(3000.0, 44.0), (6000.0, 34.0), (10000.0, 25.0), (5000.0, 15.0)]
PIVOT = (8.0, 64.0)


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    xs = S.axis(-200, 200, (-44, 44), 0.12)
    ys = S.axis(-80, 460, (-6, 128), 0.12)
    X, Y = S.np.meshgrid(xs, ys)
    Z = S.terrain_heights(f, X, Y, hills=16.0)
    land = S.grid_mesh("terrain", X, Y, Z)
    land.data.materials.append(S.rock_material())

    # Deposits span the whole land and taper out with the land's fade past both ends of the
    # recorded window, so no ruled edge shows anywhere.
    layers = S.build_deposit_stack(f, DEPOSITS, -24.0, 143.0, x_max=200.0, n_u=520, step=0.18)
    glow = S.ochre_layer_material().node_tree.nodes.get("body_glow")
    glow.outputs[0].default_value = 0.10
    del layers

    sun_az, sun_el = -112.0, 9.0
    S.setup_world(
        S.Sky(zenith="#0D161D", upper="#2A3A45", mid="#7A7868", horizon="#E2B47A", glow="#F4C47A", glow_strength=1.6, strength=1.25),
        S.sun_direction(sun_az, sun_el),
    )
    S.add_sun(sun_az, sun_el, strength=10.0, color_hex="#FFBD76", angle_deg=2.2)
    S.add_haze(density=0.0013, falloff_m=7.0, size=(420.0, 560.0, 70.0), center=(0.0, 150.0, 0.0), color_hex="#A9B0B0")
    S.setup_render()
    S.setup_compositor(bloom=0.1, vignette=0.22, lift=(0.97, 0.995, 1.03), gain=(1.06, 1.0, 0.93))

    cam = S.make_camera(lens=32.0, fstop=8.0)
    V = S.mathutils.Vector
    radius, height = 84.0, 21.0

    def eye(t: float):
        a = math.radians(-170.0 + 12.0 * S.ease_in_out(0.08 + 0.84 * t))
        return V((PIVOT[0] + radius * math.sin(a), PIVOT[1] + radius * math.cos(a), height))

    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=eye,
        target_at=lambda t: V((PIVOT[0], PIVOT[1], 11.5)),
        focus_at=lambda t: V((PIVOT[0], PIVOT[1] - 30.0, 0.0)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=150)
