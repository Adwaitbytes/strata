"""Shared scene kit for the STRATA film Blender shots (Blender 5.2, EEVEE).

Every shot script imports this module, builds the terrain from the real BASELINE heightfield
(film/assets/data/heightfield_nvda.json), then adds its own camera and animation.

Scene units: 1 m = 10 bps of price distance (X), 1 m = 60 s of recording time (Y),
height = sqrt(cumulative depth USD) scaled so the deepest point is H_MAX metres (Z).
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
import mathutils
import numpy as np

REPO = Path(__file__).resolve().parents[3]
HEIGHTFIELD = REPO / "film/assets/data/heightfield_nvda.json"
OUT_ROOT = REPO / "film/assets/blender"

FPS = 30
BPS_PER_M = 10.0
SECONDS_PER_M = 60.0
H_MAX = 7.0
BASE_Z = -7.0

# Brand palette, sRGB hex, from packages/ui/src/tokens.ts (dark theme and terrainScene.dark).
PAL = {
    "bg": "#0D0F0E",
    "rockLow": "#101311",
    "rockHigh": "#2A2F2B",
    "chalk": "#ECE8DF",
    "ochre": "#E9A94B",
    "ochreStrong": "#F4C47A",
    "bid": "#7CC9A0",
    "ask": "#EA8A6A",
    "halt": "#F0656E",
    "baseline": "#9AA39C",
}


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h: str, scale: float = 1.0) -> tuple[float, float, float, float]:
    h = h.lstrip("#")
    r, g, b = (srgb_to_linear(int(h[i : i + 2], 16) / 255.0) * scale for i in (0, 2, 4))
    return (r, g, b, 1.0)


def linear_to_hex(c: tuple) -> str:
    def enc(v: float) -> int:
        v = min(max(v, 0.0), 1.0)
        return round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055))

    return "#" + "".join(f"{enc(v):02X}" for v in c[:3])


def mixc(a: tuple, b: tuple, t: float) -> tuple[float, float, float, float]:
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3)) + (1.0,)


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------


@dataclass
class Args:
    mode: str = "still"  # still | anim | none
    frame: int | None = None
    frames: tuple[int, int] | None = None
    samples: int | None = None
    res: int = 100
    out: str | None = None


def parse_args() -> Args:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    a = Args()
    it = iter(argv)
    for tok in it:
        if tok == "--mode":
            a.mode = next(it)
        elif tok == "--frame":
            a.frame = int(next(it))
        elif tok == "--frames":
            lo, hi = next(it).split("-")
            a.frames = (int(lo), int(hi))
        elif tok == "--samples":
            a.samples = int(next(it))
        elif tok == "--res":
            a.res = int(next(it))
        elif tok == "--out":
            a.out = next(it)
        else:
            raise SystemExit(f"unknown argument: {tok}")
    return a


# --------------------------------------------------------------------------------------------
# Data: heightfield
# --------------------------------------------------------------------------------------------


def _gauss(a: np.ndarray, sigma: float, axis: int) -> np.ndarray:
    if sigma <= 0:
        return a
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    p = np.pad(a, pad, mode="edge")
    out = np.zeros_like(a)
    n = a.shape[axis]
    for i, w in enumerate(k):
        sl = [slice(None)] * a.ndim
        sl[axis] = slice(i, i + n)
        out += w * p[tuple(sl)]
    return out


def _value_noise(x: np.ndarray, y: np.ndarray, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf = x - xi
    yf = y - yi
    ox, oy = xi.min(), yi.min()
    w = int(xi.max() - ox + 2)
    h = int(yi.max() - oy + 2)
    lat = rng.random((h, w)) * 2 - 1
    xi = xi - ox
    yi = yi - oy
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = lat[yi, xi]
    b = lat[yi, xi + 1]
    c = lat[yi + 1, xi]
    d = lat[yi + 1, xi + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def fbm(x: np.ndarray, y: np.ndarray, base: float, octaves: int, seed: int, gain: float = 0.5) -> np.ndarray:
    out = np.zeros_like(x)
    amp, freq, norm = 1.0, base, 0.0
    for o in range(octaves):
        out += amp * _value_noise(x * freq, y * freq, seed + o * 101)
        norm += amp
        amp *= gain
        freq *= 2.03
    return out / norm


@dataclass
class Field:
    doc: dict
    usd: np.ndarray  # (T, X) raw grid, USD
    x_m: np.ndarray  # column centres in metres
    y_m: np.ndarray  # row starts in metres
    h: np.ndarray  # sqrt-scaled height in metres, smoothed

    @property
    def width(self) -> float:
        return float(self.x_m[-1] - self.x_m[0])

    @property
    def length(self) -> float:
        return float(self.y_m[-1] - self.y_m[0])


def load_field(sigma_x: float = 2.0, sigma_t: float = 2.0, talus: float = 0.3) -> Field:
    """Data heights. Smoothing is sigma_x cells (4 bps each) and sigma_t cells (30 s each).
    `talus` adds a low debris apron at cliff feet: max(h, talus * blur(h, 3 cells))."""
    doc = json.loads(HEIGHTFIELD.read_text())
    usd = np.array(doc["grid"], dtype=np.float64)
    x_m = np.array(doc["axes"]["x"]["values"], dtype=np.float64) / BPS_PER_M
    bin_s = float(doc["axes"]["y"]["binSeconds"])
    y_m = np.arange(usd.shape[0]) * bin_s / SECONDS_PER_M
    h = np.sqrt(usd) / math.sqrt(usd.max()) * H_MAX
    h = _gauss(_gauss(h, sigma_x, 1), sigma_t, 0)
    if talus > 0:
        h = np.maximum(h, talus * _gauss(_gauss(h, 3.0, 1), 3.0, 0))
    return Field(doc=doc, usd=usd, x_m=x_m, y_m=y_m, h=h)


def with_deposits(f: Field, deposits: list[tuple[float, float]], sigma_x: float = 2.0, sigma_t: float = 2.0, talus: float = 0.3) -> Field:
    """A copy of the field with extra resting depth: each (usd, bps) adds `usd` on both sides
    at `bps` from mid, so cumulative depth rises for every |x| >= bps. Heights keep the
    original scale (sqrt of the recorded maximum = H_MAX). Used for illustrated deposits."""
    usd = f.usd.copy()
    x_bps = f.x_m * BPS_PER_M
    for amount, bps in deposits:
        usd += amount * (np.abs(x_bps) >= bps - 1e-9)
    h = np.sqrt(usd) / math.sqrt(f.usd.max()) * H_MAX
    h = _gauss(_gauss(h, sigma_x, 1), sigma_t, 0)
    if talus > 0:
        h = np.maximum(h, talus * _gauss(_gauss(h, 3.0, 1), 3.0, 0))
    return Field(doc=f.doc, usd=usd, x_m=f.x_m, y_m=f.y_m, h=h)


def row_at(f: Field, y_m: float) -> int:
    return int(round((y_m - f.y_m[0]) / (f.y_m[1] - f.y_m[0])))


def sample_field(f: Field, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Bilinear sample of the data height at metre coordinates, edges clamped."""
    fx = np.clip((X - f.x_m[0]) / (f.x_m[1] - f.x_m[0]), 0, len(f.x_m) - 1.001)
    fy = np.clip((Y - f.y_m[0]) / (f.y_m[1] - f.y_m[0]), 0, len(f.y_m) - 1.001)
    ix = np.floor(fx).astype(int)
    iy = np.floor(fy).astype(int)
    tx = fx - ix
    ty = fy - iy
    h = f.h
    a = h[iy, ix]
    b = h[iy, ix + 1]
    c = h[iy + 1, ix]
    d = h[iy + 1, ix + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def terrace_slopes(H: np.ndarray, X: np.ndarray, Y: np.ndarray, step: float) -> np.ndarray:
    """Step canyon walls into ledges, the way hard beds stand out of soft ones.

    Only slopes change: the blend weight is zero on flat ground, so every plateau keeps its
    data height exactly."""
    if step <= 0:
        return H
    q = H / step
    n = np.floor(q)
    fr = q - n
    g = np.clip((fr - 0.6) / 0.4, 0, 1)
    g = g * g * (3 - 2 * g)
    T = (n + g) * step
    # Works on any structured patch (rows need not share x), not only on meshgrids.
    gx = np.gradient(H, axis=1) / np.where(np.abs(dxa := np.gradient(X, axis=1)) < 1e-9, 1e-9, dxa)
    gy = np.gradient(H, axis=0) / np.where(np.abs(dya := np.gradient(Y, axis=0)) < 1e-9, 1e-9, dya)
    slope = np.hypot(gx, gy)
    w = np.clip((slope - 0.15) / 0.6, 0, 1) * 0.9
    return H + (T - H) * w


def terrain_heights(
    f: Field,
    X: np.ndarray,
    Y: np.ndarray,
    warp: float = 0.55,
    relief: float = 0.11,
    y_fade: float = 22.0,
    seed: int = 7,
    terrace_step: float = 0.85,
    hills: float = 9.0,
) -> np.ndarray:
    """Data height plus rendering texture.

    `warp` jitters where the data is read by up to that many metres (6 bps, 33 s at 0.55 m),
    so mesa edges erode naturally instead of reading as extruded steps. `relief` is
    procedural rock texture amplitude. Outside the recorded window the land fades to a plain
    over `y_fade` metres, so nothing past the window pretends to be data.
    """
    wx = fbm(X, Y, 0.35, 4, seed) * warp
    wy = fbm(X + 31.7, Y - 12.3, 0.35, 4, seed + 1) * warp
    # Gullies: the cliff line wanders faster along the cliff than across it.
    wx += fbm(X * 0.4, Y * 2.4, 0.9, 4, seed + 2) * warp * 0.45
    # Time seams (a moment when the bids thinned) wander across the bank instead of ruling it.
    wy += fbm(X * 0.9, Y * 0.2, 0.45, 4, seed + 3) * warp * 4.0
    H = sample_field(f, X + wx, Y + wy)
    H = terrace_slopes(H, X, Y, step=terrace_step)
    y0, y1 = f.y_m[0], f.y_m[-1]
    dy = np.maximum(y0 - Y, 0) + np.maximum(Y - y1, 0)
    fade = 1 - np.clip(dy / y_fade, 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    H = H * fade
    # Far scenery only: low hills well outside the recorded window, lost in haze.
    if hills > 0:
        ddx = np.maximum(np.abs(X) - (f.x_m[-1] + 30), 0)
        ddy = np.maximum(y0 - 30 - Y, 0) + np.maximum(Y - y1 - 45, 0)
        far = np.clip(np.hypot(ddx, ddy) / 90.0, 0, 1)
        H = H + (fbm(X, Y, 0.01, 4, seed + 21) * 0.5 + 0.5) ** 1.5 * hills * far * far
    rock = fbm(X, Y, 0.22, 5, seed + 5) * relief + fbm(X, Y, 1.6, 2, seed + 9) * relief * 0.2
    # Plateau tops weather more than the canyon floor.
    return H + rock * (0.6 + 0.4 * np.clip(H / 2.0, 0, 1))


# --------------------------------------------------------------------------------------------
# Mesh building
# --------------------------------------------------------------------------------------------


def grid_mesh(name: str, X: np.ndarray, Y: np.ndarray, Z: np.ndarray) -> bpy.types.Object:
    rows, cols = X.shape
    verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3).astype(np.float32)
    idx = np.arange(rows * cols).reshape(rows, cols)
    a = idx[:-1, :-1].ravel()
    b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[1:, :-1].ravel()
    quads = np.stack([a, b, c, d], axis=-1).astype(np.int32)
    return mesh_from_arrays(name, verts, quads)


def mesh_from_arrays(name: str, verts: np.ndarray, quads: np.ndarray, smooth: bool = True) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    nf = len(quads)
    me.loops.add(nf * 4)
    me.loops.foreach_set("vertex_index", quads.ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set("loop_start", np.arange(0, nf * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def axis(lo: float, hi: float, core: tuple[float, float], step: float, outer_step: float = 0.5, outer_n: int = 70) -> np.ndarray:
    """Fine uniform spacing inside `core`, geometric growth out to lo and hi."""
    a = np.arange(core[0], core[1] + 1e-6, step)
    left = core[0] - np.geomspace(outer_step, core[0] - lo, outer_n)[::-1] if lo < core[0] else np.array([])
    right = core[1] + np.geomspace(outer_step, hi - core[1], outer_n) if hi > core[1] else np.array([])
    return np.concatenate([left, a, right])


def _wall_strips(edges: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, bool]], levels: int = 24):
    """Quads between a top edge polyline and a bottom polyline. Each edge is
    (px, py, ztop, zbot, outward_is_left_of_travel)."""
    verts: list[np.ndarray] = []
    quads: list[np.ndarray] = []
    off = 0
    for px, py, zt, zb, flip in edges:
        n = len(px)
        zs = [zt + (zb - zt) * (k / levels) for k in range(levels + 1)]
        verts.append(np.concatenate([np.stack([px, py, z], axis=-1) for z in zs]))
        for k in range(levels):
            top = off + k * n + np.arange(n - 1)
            q = np.stack([top, top + 1, top + 1 + n, top + n], axis=-1)
            quads.append(q[:, ::-1] if flip else q)
        off += n * (levels + 1)
    return np.concatenate(verts).astype(np.float32), np.concatenate(quads).astype(np.int32)


def walls_mesh(name: str, X: np.ndarray, Y: np.ndarray, Ztop: np.ndarray, Zbot, levels: int = 24) -> bpy.types.Object:
    """Four cut faces around a grid patch, from Ztop down to Zbot (array or scalar).

    Winding: a strip running in +x with the top edge first faces +y, so front (min y) and
    right (max x) strips are flipped to face outward."""
    Zb = np.broadcast_to(np.asarray(Zbot, dtype=np.float64), Ztop.shape)
    v, q = _wall_strips(
        [
            (X[0, :], Y[0, :], Ztop[0, :], Zb[0, :], True),
            (X[-1, :], Y[-1, :], Ztop[-1, :], Zb[-1, :], False),
            (X[:, 0], Y[:, 0], Ztop[:, 0], Zb[:, 0], False),
            (X[:, -1], Y[:, -1], Ztop[:, -1], Zb[:, -1], True),
        ],
        levels,
    )
    return mesh_from_arrays(name, v, q, smooth=False)


def build_land_block(
    f: "Field",
    xs: np.ndarray,
    ys: np.ndarray,
    base_z: float = BASE_Z,
    name: str = "land",
    **hkw,
) -> tuple[bpy.types.Object, bpy.types.Object, np.ndarray]:
    """A solid slab of land: surface plus four cut faces down to base_z. Returns
    (surface, walls, Z). Walls are their own object so their normals stay crisp."""
    X, Y = np.meshgrid(xs, ys)
    Z = terrain_heights(f, X, Y, **hkw)
    surf = grid_mesh(f"{name}_top", X, Y, Z)
    walls = walls_mesh(f"{name}_walls", X, Y, Z, base_z)
    return surf, walls, Z


def shell_mesh(
    name: str,
    X: np.ndarray,
    Y: np.ndarray,
    Ztop: np.ndarray,
    Zbot: np.ndarray,
    attrs: dict[str, np.ndarray] | None = None,
) -> bpy.types.Object:
    """A closed sheet between two surfaces over one grid patch (top, bottom, four sides).
    `attrs` are per-grid-point floats, copied to the matching top, bottom and wall points."""
    rows, cols = X.shape
    top = np.stack([X, Y, Ztop], axis=-1).reshape(-1, 3)
    bot = np.stack([X, Y, Zbot], axis=-1).reshape(-1, 3)
    idx = np.arange(rows * cols).reshape(rows, cols)
    a, b_, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    q_top = np.stack([a, b_, c, d], axis=-1)
    q_bot = np.stack([d, c, b_, a], axis=-1) + rows * cols
    levels = 4
    edge_sl = [(0, slice(None), True), (-1, slice(None), False), (slice(None), 0, False), (slice(None), -1, True)]
    wv, wq = _wall_strips([(X[r, c_], Y[r, c_], Ztop[r, c_], Zbot[r, c_], fl) for r, c_, fl in edge_sl], levels=levels)
    verts = np.concatenate([top, bot, wv]).astype(np.float32)
    quads = np.concatenate([q_top, q_bot, wq + 2 * rows * cols]).astype(np.int32)
    ob = mesh_from_arrays(name, verts, quads, smooth=True)
    # Sides and underside read as cut rock: flat shaded.
    smooth = np.zeros(len(quads), dtype=bool)
    smooth[: len(q_top)] = True
    ob.data.polygons.foreach_set("use_smooth", smooth)
    # "base_m": height above the sheet's own bottom, in metres.
    above = verts[:, 2] - np.concatenate(
        [Zbot.ravel(), Zbot.ravel()] + [np.tile(Zbot[r, c_], levels + 1) for r, c_, _ in edge_sl]
    )
    att = ob.data.attributes.new("base_m", "FLOAT", "POINT")
    att.data.foreach_set("value", above.astype(np.float32))
    for key, A in (attrs or {}).items():
        walls = np.concatenate([np.tile(A[r, c_], levels + 1) for r, c_, _ in edge_sl])
        vals = np.concatenate([A.ravel(), A.ravel(), walls]).astype(np.float32)
        att = ob.data.attributes.new(key, "FLOAT", "POINT")
        att.data.foreach_set("value", vals)
    return ob


DEPOSIT_TONES = ("#7C7D72", "#8A887A", "#7A8076")
MIN_THICK = 0.03


def deposit_patch(f_prev: "Field", f_next: "Field", side: int, ys: np.ndarray, n_u: int, x_max: float):
    """Grid for one side of one deposit. Each row starts where the deposit becomes thicker
    than MIN_THICK, found on a fine probe line, so the lip follows the land's own contour.
    Returns (X, Y, Ztop, Zbottom, lip distance)."""
    probe = np.linspace(0.0, 12.0, 961)
    PX, PY = np.meshgrid(side * probe, ys)
    T = terrain_heights(f_next, PX, PY) - terrain_heights(f_prev, PX, PY)
    ok = T > MIN_THICK
    first = np.argmax(ok, axis=1)
    rows = np.arange(len(ys))
    i0 = np.clip(first - 1, 0, len(probe) - 1)
    t0 = T[rows, i0]
    t1 = T[rows, first]
    frac = np.clip((MIN_THICK - t0) / np.maximum(t1 - t0, 1e-6), 0, 1)
    edge = np.where(first > 0, probe[i0] + frac * (probe[1] - probe[0]), probe[first])
    # Rows with no deposit at all (where the land fades out past the window) collapse.
    edge = np.where(ok.any(axis=1), edge, x_max - 0.01)
    u = np.linspace(0.0, 1.0, n_u) ** 1.6  # denser near the lip
    X = side * (edge[:, None] + (x_max - edge[:, None]) * u[None, :])
    Y = np.repeat(ys[:, None], n_u, axis=1)
    if side < 0:
        X = X[:, ::-1]
    zt = terrain_heights(f_next, X, Y)
    zb = terrain_heights(f_prev, X, Y)
    zt = np.maximum(zt, zb + MIN_THICK)
    lip = np.abs(X) - edge[:, None]
    # Bottoms sink into the layer below so interpolation never opens a slit between them.
    return X, Y, zt, zb - PARTING_SINK, lip


def build_deposit_stack(
    f: "Field",
    deposits: list[tuple[float, float]],
    y_lo: float,
    y_hi: float,
    x_max: float = 36.0,
    n_u: int = 420,
    step: float = 0.15,
) -> list[tuple[bpy.types.Material, list[bpy.types.Object]]]:
    """Illustrated deposits on the real land, bottom to top; the last one is the ochre STRATA
    stratum. Returns one (material, [bid object, ask object]) per layer."""
    out = []
    prev = f
    acc: list[tuple[float, float]] = []
    for i, dep in enumerate(deposits):
        acc.append(dep)
        nxt = with_deposits(f, acc)
        last = i == len(deposits) - 1
        mat = ochre_layer_material() if last else deposit_material(f"deposit_{i}", DEPOSIT_TONES[i % len(DEPOSIT_TONES)])
        # Each layer's cut face sits a few millimetres behind the one below, so the overlap
        # where a bottom sinks into the previous layer never z-fights.
        y0 = y_lo + 0.004 * (i + 1)
        ys = axis(y0, y_hi, (y0, y_hi), step)
        obs = []
        for side in (-1, 1):
            X, Y, zt, zb, lip = deposit_patch(prev, nxt, side, ys, n_u, x_max)
            cut = np.zeros_like(X)
            cut[0, :] = 1.0
            ob = shell_mesh(f"deposit_{i}_{'bid' if side < 0 else 'ask'}", X, Y, zt, zb, attrs={"lip": lip, "cut": cut})
            ob.data.materials.append(mat)
            obs.append(ob)
        out.append((mat, obs))
        prev = nxt
    return out


# --------------------------------------------------------------------------------------------
# Node helpers
# --------------------------------------------------------------------------------------------


class NB:
    """Small builder that keeps node graphs in Python readable."""

    def __init__(self, tree: bpy.types.NodeTree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links

    def node(self, kind: str, **props):
        n = self.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def set(self, sock, v) -> None:
        if isinstance(v, bpy.types.NodeSocket):
            self.links.new(v, sock)
        elif v is not None:
            sock.default_value = v

    def math(self, op: str, a, b=None, c=None, clamp: bool = False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        if c is not None:
            self.set(n.inputs[2], c)
        return n.outputs[0]

    def vmath(self, op: str, a, b=None, scale=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        if scale is not None:
            self.set(n.inputs["Scale"], scale)
        return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]

    def smooth(self, v, lo: float, hi: float, to_lo: float = 0.0, to_hi: float = 1.0):
        # Blender's smoothstep returns 1 for any value past From Max when the range is
        # reversed, so a falling edge is built as a rising edge mapped onto (to_hi, to_lo).
        if lo > hi:
            lo, hi, to_lo, to_hi = hi, lo, to_hi, to_lo
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.set(n.inputs["Value"], v)
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        n.inputs["To Min"].default_value = to_lo
        n.inputs["To Max"].default_value = to_hi
        return n.outputs["Result"]

    def node_smooth_var(self, v, width):
        """smoothstep(0, width, v) where width is a socket."""
        t = self.math("DIVIDE", v, self.math("MAXIMUM", width, 1e-6), clamp=True)
        return self.math("MULTIPLY", self.math("MULTIPLY", t, t), self.math("SUBTRACT", 3.0, self.math("MULTIPLY", t, 2.0)))

    def mix(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self.set(n.inputs[0], fac)
        ins = [s for s in n.inputs if s.type == "RGBA"]
        self.set(ins[0], a)
        self.set(ins[1], b)
        return [s for s in n.outputs if s.type == "RGBA"][0]

    def mixf(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="FLOAT")
        self.set(n.inputs[0], fac)
        ins = [s for s in n.inputs if s.type == "VALUE" and s.name in ("A", "B")]
        self.set(ins[0], a)
        self.set(ins[1], b)
        return [s for s in n.outputs if s.type == "VALUE"][0]

    def noise(self, vec, scale: float, detail: float = 4.0, rough: float = 0.55, dims: str = "3D", w=None):
        n = self.node("ShaderNodeTexNoise", noise_dimensions=dims)
        self.set(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        if w is not None:
            self.set(n.inputs["W"], w)
        return n.outputs["Fac"]

    def ramp(self, fac, stops: list[tuple[float, tuple]], interp: str = "LINEAR"):
        n = self.node("ShaderNodeValToRGB")
        self.set(n.inputs["Fac"], fac)
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = col
        return n.outputs["Color"]

    def sep(self, vec):
        n = self.node("ShaderNodeSeparateXYZ")
        self.set(n.inputs[0], vec)
        return n.outputs

    def value(self, v: float, label: str = ""):
        n = self.node("ShaderNodeValue", label=label, name=label or "Value")
        n.outputs[0].default_value = v
        return n.outputs[0]


# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------


BASALT_TOP = ("#2A2F2C", "#4C544F", "#3B403B")
PARTING_SINK = 0.25
BASALT_BEDS = ("#232824", "#373E39", "#53554D", "#6B675A", "#3F4640")


def rock_material(
    name: str = "basalt",
    contour_step: float = 0.32,
    contour_strength: float = 1.0,
    strata_tint: float = 0.2,
    band_height: float = 0.55,
    base_albedo: float = 1.0,
    top: tuple[str, str, str] = BASALT_TOP,
    beds_hex: tuple[str, ...] = BASALT_BEDS,
    joints_on: bool = True,
    dark_floor: bool = True,
    body_glow_hex: str | None = None,
    crest_attr: str | None = None,
    crest_beds_hex: tuple[str, ...] | None = None,
    parting: bool = False,
) -> bpy.types.Material:
    """Basalt top with survey contours; steep faces and cuts turn to sedimentary strata.

    Animatable value nodes: "contour_gain", "glow_gain" (contour glow), and "body_glow" when
    body_glow_hex is set (the STRATA stratum warms from inside).
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    if hasattr(mat, "use_transparent_shadow"):
        mat.use_transparent_shadow = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = NB(nt)
    geo = b.node("ShaderNodeNewGeometry")
    tc = b.node("ShaderNodeTexCoord")
    pos = tc.outputs["Object"]
    P = b.sep(pos)
    N = b.sep(geo.outputs["Normal"])
    z = P[2]
    x = P[0]

    # Slope: 0 on flat ground, 1 on vertical faces.
    slope = b.smooth(N[2], 0.78, 0.42)

    # Basalt: two scales of mineral mottling with a faint green-grey bias.
    mott = b.noise(pos, 0.9, detail=6, rough=0.6)
    fine = b.noise(pos, 9.0, detail=3, rough=0.5)
    # Albedo of real basalt (about 0.05 to 0.1 linear), hue from the brand rock colours.
    rock_lo = hexc(top[0], base_albedo)
    rock_hi = hexc(top[1], base_albedo)
    rock = b.ramp(mott, [(0.25, rock_lo), (0.80, rock_hi)])
    rock = b.mix(b.math("MULTIPLY", fine, 0.18), rock, hexc(top[2], base_albedo))

    # Strata: horizontal beds warped gently, one random tone per bed, thin dark bedding planes.
    warp = b.math("MULTIPLY", b.noise(pos, 0.18, detail=2), 0.9)
    zb = b.math("DIVIDE", b.math("ADD", z, warp), band_height)
    bed = b.math("FLOOR", zb)
    bed_frac = b.math("FRACT", zb)
    wn = b.node("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
    b.set(wn.inputs["W"], bed)
    bed_rand = wn.outputs["Value"]
    beds = b.ramp(
        bed_rand,
        [(i / (len(beds_hex) - 1), hexc(c, base_albedo)) for i, c in enumerate(beds_hex)],
        interp="CONSTANT",
    )
    # Bedding plane: dark line at the bottom of each bed.
    plane = b.math("SUBTRACT", 1.0, b.smooth(bed_frac, 0.0, 0.07))
    beds = b.mix(b.math("MULTIPLY", plane, 0.7), beds, hexc("#141613"))
    # Grain within beds.
    grain = b.noise(b.vmath("MULTIPLY", pos, (1.0, 1.0, 6.0)), 3.0, detail=4)
    beds = b.mix(b.math("MULTIPLY", grain, 0.3), beds, hexc("#262A25"))
    # Side tint: malachite where bids rest (x < 0), oxide where asks rest (x > 0).
    side = b.smooth(x, -1.2, 1.2)
    tint = b.mix(side, hexc(PAL["bid"], 0.4), hexc(PAL["ask"], 0.4))
    tint_amt = b.math("MULTIPLY", b.math("ADD", b.math("MULTIPLY", bed_rand, 0.6), 0.4), strata_tint)
    beds = b.mix(tint_amt, beds, tint)

    joints = None
    if joints_on:
        # Columnar jointing on flat basalt: a polygonal crack net, a few centimetres wide.
        vor = b.node("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", voronoi_dimensions="2D")
        b.set(vor.inputs["Vector"], b.vmath("ADD", pos, b.vmath("MULTIPLY", (0.25, 0.25, 0.0), b.node("ShaderNodeTexNoise").outputs["Color"])))
        vor.inputs["Scale"].default_value = 0.8
        vor.inputs["Randomness"].default_value = 1.0
        joints = b.math("SUBTRACT", 1.0, b.smooth(vor.outputs["Distance"], 0.0, 0.03))
        # Only in patches, only on raised ground: weathered joints, not paving.
        patches = b.smooth(b.noise(pos, 0.12, detail=2), 0.48, 0.62)
        joints = b.math("MULTIPLY", joints, b.math("MULTIPLY", b.math("SUBTRACT", 1.0, slope), patches))
        joints = b.math("MULTIPLY", joints, b.smooth(z, 0.3, 0.6))
        rock = b.mix(b.math("MULTIPLY", joints, 0.35), rock, hexc("#151815", base_albedo))
    if dark_floor:
        # The canyon floor is the oldest, darkest rock: the eye reads the gap as depth.
        floor = b.smooth(z, 0.15, 0.55)
        rock = b.mix(b.math("MULTIPLY", b.math("SUBTRACT", 1.0, floor), 0.6), rock, hexc("#181B19", base_albedo))

    albedo = b.mix(slope, rock, beds)

    if parting:
        # A deposit's own base: a crisp dark parting where it rests on the older rock.
        # Bottoms sink PARTING_SINK metres into the rock below; the parting sits just above.
        base = b.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="base_m")
        bm = base.outputs["Fac"]
        part = b.math("MULTIPLY", b.smooth(bm, PARTING_SINK - 0.02, PARTING_SINK), b.smooth(bm, PARTING_SINK + 0.09, PARTING_SINK + 0.05))
        albedo = b.mix(b.math("MULTIPLY", part, 0.9), albedo, hexc("#0B0C0B"))

    crest = None
    if crest_attr and crest_beds_hex:
        # Colour lives along the crest (near the canyon lip) and on the section band only.
        att = b.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=crest_attr)
        near_lip = b.smooth(att.outputs["Fac"], 1.9, 0.3)
        cut = b.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="cut")
        section = b.math("MULTIPLY", b.smooth(b.math("MULTIPLY", N[1], -1.0), 0.55, 0.85), cut.outputs["Fac"])
        crest = b.math("MAXIMUM", near_lip, section)
        cbeds = b.ramp(bed_rand, [(i / (len(crest_beds_hex) - 1), hexc(c)) for i, c in enumerate(crest_beds_hex)], interp="CONSTANT")
        cbeds = b.mix(b.math("MULTIPLY", plane, 0.6), cbeds, hexc("#2A1E0E"))
        cbeds = b.mix(b.math("MULTIPLY", grain, 0.25), cbeds, hexc("#4A3417"))
        albedo = b.mix(crest, albedo, cbeds)

    # Survey contours, index line every fifth. Distance to the nearest level is converted from
    # height to ground distance through the slope, and the width grows with view distance, so
    # lines stay about two pixels wide everywhere (no fwidth in shader nodes).
    cam = b.node("ShaderNodeCameraData")
    vdist = cam.outputs["View Distance"]
    nz = b.math("MAXIMUM", N[2], 0.05)
    tan = b.math("DIVIDE", b.math("SQRT", b.math("MAXIMUM", b.math("SUBTRACT", 1.0, b.math("MULTIPLY", N[2], N[2])), 0.0)), nz)
    tan = b.math("MAXIMUM", tan, 0.002)

    def contour(step: float, px: float):
        q = b.math("DIVIDE", z, step)
        fr_ = b.math("FRACT", q)
        dz = b.math("MULTIPLY", b.math("MINIMUM", fr_, b.math("SUBTRACT", 1.0, fr_)), step)
        dh = b.math("DIVIDE", dz, tan)
        width = b.math("MULTIPLY", vdist, px)
        return b.math("SUBTRACT", 1.0, b.node_smooth_var(dh, width))

    line = contour(contour_step, 0.0011)
    line_i = contour(contour_step * 5, 0.0019)
    lines = b.math("MAXIMUM", b.math("MULTIPLY", line, 0.5), line_i)
    far_fade = b.smooth(vdist, 160.0, 50.0)
    flat = b.smooth(N[2], 0.80, 0.97)
    contour_gain = b.value(contour_strength, "contour_gain")
    cmask = b.math("MULTIPLY", b.math("MULTIPLY", lines, far_fade), b.math("MULTIPLY", flat, contour_gain))
    contour_col = mixc(hexc(PAL["chalk"]), hexc(PAL["ochre"]), 0.55)
    albedo = b.mix(b.math("MULTIPLY", cmask, 0.28), albedo, contour_col)

    bsdf = b.node("ShaderNodeBsdfPrincipled")
    b.set(bsdf.inputs["Base Color"], albedo)
    # "fade" lets a deposit condense out of the air (dithered alpha, resolved by TAA).
    b.set(bsdf.inputs["Alpha"], b.value(1.0, "fade"))
    rough = b.math("ADD", 0.62, b.math("MULTIPLY", fine, 0.25))
    b.set(bsdf.inputs["Roughness"], rough)
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    glow_gain = b.value(0.07, "glow_gain")
    emit = b.math("MULTIPLY", cmask, glow_gain)
    if body_glow_hex:
        body = b.value(0.0, "body_glow")
        # Warmth lives in the grain, brighter in fine seams, so it reads as mineral, not lava.
        seam = b.math("ADD", 0.45, b.math("MULTIPLY", b.math("SUBTRACT", 1.0, mott), 0.9))
        b.set(bsdf.inputs["Emission Color"], b.mix(b.math("MULTIPLY", cmask, 0.6), hexc(body_glow_hex), contour_col))
        # Only the crest and the section band carry the warmth.
        on_face = crest if crest is not None else b.math("ADD", 0.08, b.math("MULTIPLY", slope, 0.92))
        emit = b.math("ADD", emit, b.math("MULTIPLY", b.math("MULTIPLY", body, seam), on_face))
    else:
        b.set(bsdf.inputs["Emission Color"], contour_col)
    b.set(bsdf.inputs["Emission Strength"], emit)

    # Tactile relief: two scales of bump, stronger on the beds.
    bump_h = b.math(
        "ADD",
        b.math("MULTIPLY", b.noise(pos, 2.2, detail=6, rough=0.62), 1.0),
        b.math("MULTIPLY", b.noise(pos, 14.0, detail=3), 0.35),
    )
    bump_h = b.math("ADD", bump_h, b.math("MULTIPLY", plane, b.math("MULTIPLY", slope, 0.6)))
    if joints is not None:
        bump_h = b.math("SUBTRACT", bump_h, b.math("MULTIPLY", joints, 0.35))
    bump = b.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.08
    b.set(bump.inputs["Height"], bump_h)
    b.set(bsdf.inputs["Normal"], bump.outputs["Normal"])

    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def deposit_material(name: str, tone_hex: str) -> bpy.types.Material:
    """Freshly deposited liquidity: cleaner, finer-bedded sediment than the old basalt, with a
    stronger malachite (bid side) and oxide (ask side) tint on its faces."""
    t = hexc(tone_hex)
    dark = mixc(t, hexc("#141613"), 0.45)
    light = mixc(t, hexc("#8E897E"), 0.25)

    return rock_material(
        name,
        contour_step=0.32,
        strata_tint=0.16,
        band_height=0.16,
        top=(linear_to_hex(dark), linear_to_hex(light), tone_hex),
        beds_hex=(tone_hex, linear_to_hex(light), tone_hex, linear_to_hex(light), tone_hex),
        joints_on=False,
        dark_floor=False,
        parting=True,
    )


_OCHRE: list[bpy.types.Material] = []


def ochre_layer_material() -> bpy.types.Material:
    """The STRATA stratum. One shared material so a shot can animate its "body_glow"."""
    if _OCHRE and _OCHRE[0].name in bpy.data.materials:
        return _OCHRE[0]
    m = rock_material(
        "strata_ochre",
        contour_step=0.32,
        strata_tint=0.0,
        band_height=0.12,
        top=("#2B2F2C", "#4A504A", "#3B3F3A"),
        beds_hex=("#2E302B", "#3D3F37", "#4A4A40", "#363832", "#42443B"),
        joints_on=False,
        dark_floor=False,
        body_glow_hex=PAL["ochre"],
        crest_attr="lip",
        crest_beds_hex=("#56412A", "#7A5E36", "#8E7044", "#644C2C", "#826438"),
        parting=True,
    )
    _OCHRE[:] = [m]
    return m


def dust_material(color_hex: str = "#CBBFA8", glow: float = 0.6) -> bpy.types.Material:
    mat = bpy.data.materials.new("dust")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = NB(nt)
    bsdf = b.node("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = hexc(color_hex)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Emission Color"].default_value = hexc(color_hex)
    bsdf.inputs["Emission Strength"].default_value = glow
    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Surface"], bsdf.outputs["BSDF"])
    return mat


def add_dust(
    n: int,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    frames: int,
    freeze_frame: int | None = None,
    drift: tuple[float, float, float] = (0.25, 0.35, 0.06),
    wobble: float = 0.35,
    radius: tuple[float, float] = (0.008, 0.026),
    seed: int = 3,
    material: bpy.types.Material | None = None,
    points: np.ndarray | None = None,
    sweep: tuple[float, float, float] | None = None,
    grow: float = 0.0,
    start_frame: int = 1,
) -> bpy.types.Object:
    """Airborne dust motes as instanced specks. Their motion is a pure function of a "dust_time"
    value, so freezing the dust is holding that value still (no simulation cache).

    `sweep` = (x0, x1, seconds): a mote at x starts moving (x - x0) / (x1 - x0) * seconds late,
    so a puff can follow a crack front. `grow` > 0 scales motes up from nothing over 1/grow s."""
    rng = np.random.default_rng(seed)
    pts = points if points is not None else (rng.random((n, 3)) - 0.5) * np.array(size) + np.array(center)
    n = len(pts)
    me = bpy.data.meshes.new("dust_pts")
    me.vertices.add(n)
    me.vertices.foreach_set("co", pts.astype(np.float32).ravel())
    me.update()
    ob = bpy.data.objects.new("dust", me)
    bpy.context.scene.collection.objects.link(ob)

    tree = bpy.data.node_groups.new("dust_motion", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    b = NB(tree)
    gi = b.node("NodeGroupInput")
    go = b.node("NodeGroupOutput")
    tval = b.node("ShaderNodeValue", name="dust_time", label="dust_time")
    t = tval.outputs[0]
    pos = b.node("GeometryNodeInputPosition").outputs[0]
    if sweep:
        x0, x1, secs = sweep
        px = b.sep(pos)[0]
        delay = b.math("MULTIPLY", b.math("DIVIDE", b.math("SUBTRACT", px, x0), x1 - x0, clamp=True), secs)
        t = b.math("MAXIMUM", b.math("SUBTRACT", t, delay), 0.0)
    # Slow curl-ish wander from 4D noise, plus a steady drift on the breeze.
    nz = b.node("ShaderNodeTexNoise", noise_dimensions="4D")
    b.set(nz.inputs["Vector"], b.vmath("SCALE", pos, scale=0.18))
    b.set(nz.inputs["W"], b.math("MULTIPLY", t, 0.12))
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 2.0
    wander = b.vmath("SCALE", b.vmath("SUBTRACT", nz.outputs["Color"], (0.5, 0.5, 0.5)), scale=wobble * 2)
    steady = b.vmath("SCALE", drift, scale=t)
    setpos = b.node("GeometryNodeSetPosition")
    b.set(setpos.inputs["Geometry"], gi.outputs[0])
    b.set(setpos.inputs["Offset"], b.vmath("ADD", wander, steady))
    ico = b.node("GeometryNodeMeshIcoSphere")
    ico.inputs["Radius"].default_value = 1.0
    ico.inputs["Subdivisions"].default_value = 1
    rnd = b.node("FunctionNodeRandomValue", data_type="FLOAT")
    rnd.inputs["Min"].default_value = radius[0]
    rnd.inputs["Max"].default_value = radius[1]
    rnd.inputs["Seed"].default_value = seed
    inst = b.node("GeometryNodeInstanceOnPoints")
    b.set(inst.inputs["Points"], setpos.outputs["Geometry"])
    b.set(inst.inputs["Instance"], ico.outputs["Mesh"])
    size_out = [o for o in rnd.outputs if o.type == "VALUE"][0]
    if grow > 0:
        size_out = b.math("MULTIPLY", size_out, b.math("MULTIPLY", t, grow, clamp=True))
    b.set(inst.inputs["Scale"], size_out)
    setmat = b.node("GeometryNodeSetMaterial")
    b.set(setmat.inputs["Geometry"], inst.outputs["Instances"])
    setmat.inputs["Material"].default_value = material or dust_material()
    b.set(go.inputs[0], setmat.outputs["Geometry"])
    mod = ob.modifiers.new("dust", "NODES")
    mod.node_group = tree

    stop = freeze_frame or frames
    sock = tval.outputs[0]
    for fr in sorted({1, start_frame, stop, frames}):
        sock.default_value = max(min(fr, stop) - start_frame, 0) / FPS
        sock.keyframe_insert("default_value", frame=fr)
    if tree.animation_data and tree.animation_data.action:
        for fc in fcurves(tree):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return ob


# --------------------------------------------------------------------------------------------
# World, light, render, compositor
# --------------------------------------------------------------------------------------------


@dataclass
class Sky:
    zenith: str = "#0C1517"
    upper: str = "#22333A"
    mid: str = "#5F6866"
    horizon: str = "#C9A985"
    ground: str = "#0D0F0E"
    glow: str = "#E9A94B"
    strength: float = 1.0
    glow_strength: float = 1.6


def setup_world(sky: Sky, sun_dir: mathutils.Vector, night: Sky | None = None) -> bpy.types.World:
    """Dusk gradient with a soft sun glow. With `night`, a second gradient is blended in by the
    animatable value node "night_mix" (0 = sky, 1 = night)."""
    world = bpy.data.worlds.new("dusk")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    b = NB(nt)
    tc = b.node("ShaderNodeTexCoord")
    d = b.vmath("NORMALIZE", tc.outputs["Generated"])
    D = b.sep(d)
    e = D[2]

    def gradient(k: Sky):
        return b.ramp(
            b.math("ADD", b.math("MULTIPLY", e, 0.5), 0.5),
            [
                (0.40, hexc(k.ground)),
                (0.497, hexc(k.ground)),
                (0.503, hexc(k.horizon)),
                (0.53, hexc(k.mid)),
                (0.62, hexc(k.upper)),
                (0.90, hexc(k.zenith)),
            ],
            interp="B_SPLINE",
        )

    grad = gradient(sky)
    if night is not None:
        grad = b.mix(b.value(0.0, "night_mix"), grad, gradient(night))
    sun_vec = b.node("ShaderNodeCombineXYZ", name="sun_dir", label="sun_dir")
    sun_vec.inputs[0].default_value = sun_dir.x
    sun_vec.inputs[1].default_value = sun_dir.y
    sun_vec.inputs[2].default_value = sun_dir.z
    cosang = b.math("MAXIMUM", b.vmath("DOT_PRODUCT", d, sun_vec.outputs[0]), 0.0)
    wide = b.math("POWER", cosang, 6.0)
    tight = b.math("POWER", cosang, 64.0)
    above = b.smooth(e, -0.02, 0.02)
    glow_amt = b.math("MULTIPLY", b.math("ADD", b.math("MULTIPLY", wide, 0.35), tight), above)
    gs = b.value(sky.glow_strength, "glow_strength")
    glow_amt = b.math("MULTIPLY", glow_amt, gs)
    col = b.mix(b.math("MINIMUM", glow_amt, 1.0), grad, hexc(sky.glow))
    col2 = b.node("ShaderNodeMix", data_type="RGBA", blend_type="ADD")
    b.set(col2.inputs[0], b.math("MAXIMUM", b.math("SUBTRACT", glow_amt, 1.0), 0.0))
    cins = [s for s in col2.inputs if s.type == "RGBA"]
    b.set(cins[0], col)
    b.set(cins[1], hexc(sky.glow))
    bg = b.node("ShaderNodeBackground")
    b.set(bg.inputs["Color"], [s for s in col2.outputs if s.type == "RGBA"][0])
    st = b.value(sky.strength, "sky_strength")
    b.set(bg.inputs["Strength"], st)
    out = b.node("ShaderNodeOutputWorld")
    b.set(out.inputs["Surface"], bg.outputs["Background"])
    return world


def add_haze(density: float, falloff_m: float, size: tuple[float, float, float], center=(0.0, 60.0, 0.0), color_hex: str = "#C9B79C"):
    """Ground haze in a bounded box. EEVEE treats a world volume as infinite and it swallows the
    sky, so the haze lives in a box and thins with height (density * exp(-z / falloff_m))."""
    me = bpy.data.meshes.new("haze")
    sx, sy, sz = (v / 2 for v in size)
    v = [(-sx, -sy, -8), (sx, -sy, -8), (sx, sy, -8), (-sx, sy, -8), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    fcs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(v, [], fcs)
    ob = bpy.data.objects.new("haze", me)
    ob.location = center
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new("haze")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    b = NB(nt)
    geo = b.node("ShaderNodeNewGeometry")
    P = b.sep(geo.outputs["Position"])
    zz = b.math("MAXIMUM", P[2], 0.0)
    fall = b.math("EXPONENT", b.math("DIVIDE", b.math("MULTIPLY", zz, -1.0), falloff_m))
    dn = b.value(density, "haze_density")
    vol = b.node("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = hexc(color_hex)
    vol.inputs["Anisotropy"].default_value = 0.6
    b.set(vol.inputs["Density"], b.math("MULTIPLY", fall, dn))
    out = b.node("ShaderNodeOutputMaterial")
    b.set(out.inputs["Volume"], vol.outputs["Volume"])
    me.materials.append(mat)
    return ob


def sun_direction(azimuth_deg: float, elevation_deg: float) -> mathutils.Vector:
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    return mathutils.Vector((math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)))


def add_sun(azimuth_deg: float, elevation_deg: float, strength: float, color_hex: str, angle_deg: float = 2.5):
    data = bpy.data.lights.new("sun", type="SUN")
    data.energy = strength
    data.color = hexc(color_hex)[:3]
    data.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new("sun", data)
    bpy.context.scene.collection.objects.link(ob)
    aim_sun(ob, azimuth_deg, elevation_deg)
    return ob


def aim_sun(ob: bpy.types.Object, azimuth_deg: float, elevation_deg: float) -> None:
    d = sun_direction(azimuth_deg, elevation_deg)
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


def setup_render(samples: int = 64, res_pct: int = 100, motion_blur: bool = False) -> None:
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x = 1920
    s.render.resolution_y = 1080
    s.render.resolution_percentage = res_pct
    s.render.fps = FPS
    s.render.film_transparent = False
    s.render.dither_intensity = 1.5
    s.render.use_motion_blur = motion_blur
    s.render.motion_blur_shutter = 0.5
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGB"
    s.render.image_settings.color_depth = "8"
    s.render.image_settings.compression = 15
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = "AgX - Medium High Contrast"
    s.view_settings.exposure = 0.0
    s.view_settings.gamma = 1.0
    e = s.eevee
    e.taa_render_samples = samples
    e.use_shadows = True
    e.shadow_ray_count = 2
    e.shadow_step_count = 8
    e.shadow_resolution_scale = 1.0
    e.use_raytracing = True
    e.ray_tracing_method = "SCREEN"
    e.use_fast_gi = True
    e.fast_gi_method = "GLOBAL_ILLUMINATION"
    e.volumetric_tile_size = "8"
    e.volumetric_samples = 64
    e.volumetric_end = 400.0
    e.use_volumetric_shadows = True
    e.bokeh_max_size = 60.0
    e.motion_blur_steps = 1


def setup_compositor(
    bloom: float = 0.06,
    vignette: float = 0.22,
    lift: tuple[float, float, float] = (0.985, 1.0, 1.015),
    gain: tuple[float, float, float] = (1.03, 1.0, 0.975),
) -> None:
    s = bpy.context.scene
    tree = bpy.data.node_groups.new("strata_comp", "CompositorNodeTree")
    s.compositing_node_group = tree
    s.render.use_compositing = True
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    n = tree.nodes
    L = tree.links
    rl = n.new("CompositorNodeRLayers")
    glare = n.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 0.8
    glare.inputs["Smoothness"].default_value = 0.5
    glare.inputs["Strength"].default_value = bloom
    glare.inputs["Size"].default_value = 0.7
    # Split tone: shadows lean cool (basalt), highlights lean warm (low sun).
    grade = n.new("CompositorNodeColorBalance")
    grade.inputs["Type"].default_value = "Lift/Gamma/Gain"
    cols = [x for x in grade.inputs if x.type == "RGBA"]
    cols[0].default_value = (*lift, 1.0)
    cols[2].default_value = (*gain, 1.0)
    L.new(rl.outputs["Image"], grade.inputs["Image"])
    L.new(grade.outputs["Image"], glare.inputs["Image"])
    mask = n.new("CompositorNodeEllipseMask")
    mask.inputs["Size"].default_value = (0.95, 0.85, 0.0)[: len(mask.inputs["Size"].default_value)]
    blur = n.new("CompositorNodeBlur")
    blur.inputs["Size"].default_value = (360.0, 360.0)[: len(blur.inputs["Size"].default_value)]
    L.new(mask.outputs["Mask"], blur.inputs["Image"])
    mul = n.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = vignette
    cins = [x for x in mul.inputs if x.type == "RGBA"]
    L.new(glare.outputs["Image"], cins[0])
    vig = n.new("ShaderNodeMix")
    vig.data_type = "RGBA"
    vig.inputs[0].default_value = 1.0
    vins = [x for x in vig.inputs if x.type == "RGBA"]
    vins[0].default_value = (0.0, 0.0, 0.0, 1.0)
    vins[1].default_value = (1.0, 1.0, 1.0, 1.0)
    L.new(blur.outputs["Image"], vig.inputs[0])
    L.new([x for x in vig.outputs if x.type == "RGBA"][0], cins[1])
    go = n.new("NodeGroupOutput")
    L.new([x for x in mul.outputs if x.type == "RGBA"][0], go.inputs[0])


# --------------------------------------------------------------------------------------------
# Camera
# --------------------------------------------------------------------------------------------


def ease_in_out(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (t * 6 - 15) + 10)


def ease_out(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def bezier(p: list[mathutils.Vector], t: float) -> mathutils.Vector:
    """Cubic Bezier through four control points."""
    u = 1 - t
    return p[0] * (u**3) + p[1] * (3 * u * u * t) + p[2] * (3 * u * t * t) + p[3] * (t**3)


def make_camera(lens: float = 35.0, fstop: float = 8.0, sensor: float = 36.0) -> bpy.types.Object:
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.sensor_width = sensor
    cd.clip_start = 0.1
    cd.clip_end = 1200.0
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.aperture_blades = 7
    cam = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def key_camera_path(
    cam: bpy.types.Object,
    n_frames: int,
    eye_at,
    target_at,
    focus_at=None,
    lens_at=None,
) -> None:
    """Key every frame from analytic functions of t in [0, 1]. No f-curve overshoot, no jitter."""
    for i in range(n_frames):
        t = i / max(n_frames - 1, 1)
        eye = mathutils.Vector(eye_at(t))
        tgt = mathutils.Vector(target_at(t))
        cam.location = eye
        cam.rotation_euler = (tgt - eye).to_track_quat("-Z", "Y").to_euler()
        cam.keyframe_insert("location", frame=i + 1)
        cam.keyframe_insert("rotation_euler", frame=i + 1)
        fd = (mathutils.Vector(focus_at(t)) - eye).length if focus_at else (tgt - eye).length
        cam.data.dof.focus_distance = fd
        cam.data.dof.keyframe_insert("focus_distance", frame=i + 1)
        if lens_at:
            cam.data.lens = lens_at(t)
            cam.data.keyframe_insert("lens", frame=i + 1)
    for fc in _fcurves(cam) + _fcurves(cam.data):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def _fcurves(idb) -> list:
    ad = idb.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    # Layered actions (Blender 4.4+): walk the channelbags.
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def fcurves(idb) -> list:
    return _fcurves(idb)


# --------------------------------------------------------------------------------------------
# Scene lifecycle and rendering
# --------------------------------------------------------------------------------------------


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_frames(n: int) -> None:
    s = bpy.context.scene
    s.frame_start = 1
    s.frame_end = n
    s.render.fps = FPS


def render(shot_id: str, args: Args, default_still: int) -> None:
    s = bpy.context.scene
    if args.samples:
        s.eevee.taa_render_samples = args.samples
    s.render.resolution_percentage = args.res
    out_dir = OUT_ROOT / shot_id
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.mode == "still":
        f = args.frame or default_still
        s.frame_set(f)
        s.render.filepath = args.out or str(out_dir / f"{shot_id}_still_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
    elif args.mode == "anim":
        if args.frames:
            s.frame_start, s.frame_end = args.frames
        s.render.filepath = str(out_dir / f"{shot_id}_")
        s.render.use_file_extension = True
        bpy.ops.render.render(animation=True)
    elif args.mode == "blend":
        bpy.ops.wm.save_as_mainfile(filepath=str(REPO / "infra/blender/build" / f"{shot_id}.blend"))
