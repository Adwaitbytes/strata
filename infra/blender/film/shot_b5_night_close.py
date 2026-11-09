"""B5 night_close, 6 s: the light falls from late day to night over the land, a session closing.

Land: the real NVDA/USDC PERP book (BASELINE). The camera looks forward in time toward the end
of the recorded window (20:20 to 20:47 UTC), where the real spread widened from about 150 to
about 450 bps, so the canyon opens up ahead as the light goes. As the sun drops, the survey
contours come up as the only light on the land.

    blender -b -P infra/blender/film/shot_b5_night_close.py -- --mode anim
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import strata_scene as S  # noqa: E402

SHOT = "b5_night_close"
FRAMES = 6 * S.FPS
SUN_AZ = -14.0
SUN_EL = (10.0, -5.0)


def key_value(node_tree, name: str, keys: list[tuple[int, float]]) -> None:
    sock = node_tree.nodes[name].outputs[0]
    for fr, v in keys:
        sock.default_value = v
        sock.keyframe_insert("default_value", frame=fr)


def build() -> None:
    S.reset_scene()
    S.set_frames(FRAMES)
    f = S.load_field()
    xs = S.axis(-180, 180, (-48, 48), 0.12)
    ys = S.axis(-60, 420, (50, 135), 0.12)
    X, Y = np.meshgrid(xs, ys)
    land = S.grid_mesh("terrain", X, Y, S.terrain_heights(f, X, Y))
    rock = S.rock_material()
    land.data.materials.append(rock)

    dusk = S.Sky(glow="#E9A94B", glow_strength=1.5)
    night = S.Sky(zenith="#05080C", upper="#0B1520", mid="#1B2833", horizon="#3A3A42", ground="#050606", glow="#B8583A")
    world = S.setup_world(dusk, S.sun_direction(SUN_AZ, SUN_EL[0]), night=night)
    sun = S.add_sun(SUN_AZ, SUN_EL[0], strength=7.0, color_hex="#FFD3A0", angle_deg=3.0)
    fill = S.add_sun(165.0, 38.0, strength=0.0, color_hex="#8EA5C8", angle_deg=6.0)
    fill.name = "night_fill"
    S.add_haze(density=0.0035, falloff_m=6.0, size=(360.0, 480.0, 60.0), center=(0.0, 140.0, 0.0), color_hex="#AAB0AA")
    S.setup_render(samples=40)
    S.setup_compositor(bloom=0.1, vignette=0.28)

    warm = S.hexc("#FFD3A0")
    red = S.hexc("#FF8456")
    sun_dir = world.node_tree.nodes["sun_dir"]
    for fr in range(1, FRAMES + 1):
        t = S.ease_in_out((fr - 1) / (FRAMES - 1))
        el = SUN_EL[0] + (SUN_EL[1] - SUN_EL[0]) * t
        S.aim_sun(sun, SUN_AZ, el)
        sun.keyframe_insert("rotation_euler", frame=fr)
        above = min(max((el + 1.0) / 6.0, 0.0), 1.0)
        sun.data.energy = 7.0 * above
        sun.data.keyframe_insert("energy", frame=fr)
        c = S.mixc(red, warm, above)
        sun.data.color = c[:3]
        sun.data.keyframe_insert("color", frame=fr)
        fill.data.energy = 1.1 * t
        fill.data.keyframe_insert("energy", frame=fr)
        d = S.sun_direction(SUN_AZ, el)
        for i in range(3):
            sun_dir.inputs[i].default_value = d[i]
            sun_dir.inputs[i].keyframe_insert("default_value", frame=fr)
        bpy.context.scene.view_settings.exposure = 0.75 * t
        bpy.context.scene.view_settings.keyframe_insert("exposure", frame=fr)

    key_value(world.node_tree, "night_mix", [(1, 0.0), (40, 0.0), (FRAMES - 10, 1.0)])
    key_value(world.node_tree, "glow_strength", [(1, 1.5), (FRAMES - 30, 0.6), (FRAMES, 0.25)])
    key_value(world.node_tree, "sky_strength", [(1, 1.0), (FRAMES, 0.7)])
    # The survey contours become the light on the land.
    key_value(rock.node_tree, "glow_gain", [(1, 0.07), (70, 0.12), (FRAMES - 15, 0.7)])
    key_value(rock.node_tree, "contour_gain", [(1, 1.0), (FRAMES, 1.35)])

    cam = S.make_camera(lens=32.0, fstop=5.6)
    V = S.mathutils.Vector
    e0, e1 = V((-5.5, 62.0, 7.4)), V((-4.0, 67.5, 6.6))
    t0, t1 = V((2.0, 120.0, -1.0)), V((2.4, 124.0, -1.0))
    S.key_camera_path(
        cam,
        FRAMES,
        eye_at=lambda t: e0.lerp(e1, S.ease_in_out(0.1 + 0.8 * t)),
        target_at=lambda t: t0.lerp(t1, S.ease_in_out(0.1 + 0.8 * t)),
        focus_at=lambda t: V((0.0, 95.0, 0.0)),
    )


if __name__ == "__main__":
    args = S.parse_args()
    build()
    S.render(SHOT, args, default_still=120)
