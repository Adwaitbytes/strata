/**
 * Survey terrain shader. The vertex stage builds a heightfield: one ridge per market along the
 * price axis (bids at negative x, asks at positive x, the empty valley at x = 0 is the spread),
 * height from live depth. The fragment stage draws it the way a topographic survey does:
 * contour lines from fract(height), a heavier index contour every fifth line, a hairline
 * survey grid on the ground plane, a rim light on ridge silhouettes and fog into the page color.
 *
 * Kept as plain strings (no glslify) so the lazy 3D chunk stays small.
 */

export const FIELD_WIDTH = 11;
export const FIELD_DEPTH = 8;
export const MAX_RIDGES_GPU = 6;
/** World units of height for a ridge at full depth. */
export const RIDGE_SCALE = 2.3;
/** Contour interval: lines per world unit of height. */
export const CONTOURS_PER_UNIT = 13;

const COMMON = /* glsl */ `
  #define HALF_W ${(FIELD_WIDTH / 2).toFixed(1)}
  #define HALF_D ${(FIELD_DEPTH / 2).toFixed(1)}
  #define MAX_RIDGES ${MAX_RIDGES_GPU}
`;

export const terrainVertex = /* glsl */ `
  ${COMMON}
  uniform float uTime;
  uniform float uErode;
  uniform float uDeposit;
  uniform float uFault;
  uniform float uHeights[MAX_RIDGES];
  uniform float uShares[MAX_RIDGES];
  uniform int uCount;

  varying vec3 vWorld;
  varying float vH;
  varying float vStrata;
  varying float vSide;
  varying float vFault;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // Resting size across the price axis: nothing at the mid (the spread), building away from it.
  float bookProfile(float x) {
    float d = abs(x) / HALF_W;
    return smoothstep(0.05, 0.85, d) * (1.0 - 0.4 * smoothstep(0.78, 1.0, d));
  }

  // Signed distance to the fault trace (a straight line across the survey).
  float faultTrace(vec2 p) { return dot(p, normalize(vec2(0.42, 1.0))) - 0.35; }

  void main() {
    vec2 p = position.xz;
    // Market drift: the terrain shifts slowly while books move; an engaged guard freezes it.
    float drift = uTime * 0.03 * (1.0 - uFault);
    float base = (fbm(p * 0.38 + vec2(drift, drift * 0.4)) - 0.45) * 0.24;

    float ridges = 0.0;
    float strata = 0.0;
    float n = float(max(uCount, 1));
    for (int i = 0; i < MAX_RIDGES; i++) {
      if (i >= uCount) break;
      float zc = -HALF_D * 0.66 + (HALF_D * 1.32) * (float(i) + 0.5) / n;
      float width = 2.2 / n + 0.22;
      float w = exp(-pow((p.y - zc) / width, 2.0));
      float wobble = (fbm(vec2(p.y * 0.7 + float(i) * 3.1, drift)) - 0.5) * 0.9;
      float r = uHeights[i] * ${RIDGE_SCALE.toFixed(2)} * bookProfile(p.x + wobble) * w;
      ridges += r;
      strata += r * uShares[i];
    }

    float erode = mix(1.0, 0.1, uErode);
    ridges *= erode;
    strata *= erode;
    base *= mix(1.0, 0.45, uErode);

    // Illustration: agents deposit depth near the mid, filling the spread valley.
    float field = smoothstep(HALF_D, HALF_D * 0.55, abs(p.y));
    float deposit = uDeposit * 0.75 * exp(-pow(p.x / 1.7, 2.0)) * (0.55 + 0.45 * fbm(p * 0.8 + 7.0)) * field;
    strata += deposit;

    float fd = faultTrace(p);
    float throwSide = smoothstep(-0.12, 0.12, fd);
    float h = base + ridges + deposit - uFault * 0.36 * throwSide;

    vec4 world = modelMatrix * vec4(p.x, h, p.y, 1.0);
    vWorld = world.xyz;
    vH = h;
    vStrata = clamp(strata / max(ridges + deposit, 0.0001), 0.0, 1.0) * smoothstep(0.02, 0.2, ridges + deposit);
    vSide = p.x / HALF_W;
    vFault = fd;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const terrainFragment = /* glsl */ `
  ${COMMON}
  uniform vec3 uFog;
  uniform vec3 uRockLow;
  uniform vec3 uRockHigh;
  uniform vec3 uContour;
  uniform vec3 uStrata;
  uniform vec3 uBid;
  uniform vec3 uAsk;
  uniform vec3 uFaultColor;
  uniform float uContourAlpha;
  uniform float uRim;
  uniform float uFault;
  uniform float uPlan;
  uniform float uFogDensity;
  uniform float uGlow;

  varying vec3 vWorld;
  varying float vH;
  varying float vStrata;
  varying float vSide;
  varying float vFault;

  float lineMask(float v, float widthPx) {
    float fw = max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(0.0, fw * widthPx, abs(fract(v - 0.5) - 0.5));
  }

  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 L = normalize(vec3(-0.45, 0.8, 0.4));
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float hN = clamp((vH + 0.1) / 2.4, 0.0, 1.0);
    vec3 col = mix(uRockLow, uRockHigh, hN) * (0.6 + 0.55 * diff);

    float c = vH * ${CONTOURS_PER_UNIT.toFixed(1)};
    float line = lineMask(c, 1.1);
    float index = lineMask(c / 5.0, 1.5);
    vec3 sideColor = vSide < 0.0 ? uBid : uAsk;
    vec3 lineColor = mix(uContour, sideColor, smoothstep(0.1, 0.75, abs(vSide)) * 0.7);
    col = mix(col, lineColor, clamp(uContourAlpha * line + uContourAlpha * 1.7 * index, 0.0, 1.0));

    // STRATA depth: a luminous stratum that brightens on its contour lines.
    col += uStrata * vStrata * (0.06 + 0.85 * max(line, index)) * uGlow;

    // Survey grid on the ground plane, one line per world unit.
    vec2 g = abs(fract(vWorld.xz - 0.5) - 0.5) / max(fwidth(vWorld.xz), vec2(1e-4));
    float grid = 1.0 - min(min(g.x, g.y), 1.0);
    col = mix(col, uContour, grid * (0.05 + 0.05 * uPlan));

    float fl = 1.0 - min(abs(vFault) / max(fwidth(vFault), 1e-4) / 1.6, 1.0);
    col = mix(col, uFaultColor, fl * uFault);

    vec3 V = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
    col += uContour * rim * uRim * 0.22;

    float dist = length(cameraPosition - vWorld);
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    float edge = smoothstep(0.0, 2.2, HALF_W - abs(vWorld.x)) * smoothstep(0.0, 1.6, HALF_D - abs(vWorld.z));
    gl_FragColor = vec4(mix(uFog, col, (1.0 - fog) * edge), 1.0);
    #include <colorspace_fragment>
  }
`;

/** CPU copy of the ridge crest height (no noise), used to pin HTML labels to ridge tops. */
export function ridgeCrest(index: number, count: number, height: number, side: 1 | -1 = 1): { x: number; y: number; z: number } {
  const halfW = FIELD_WIDTH / 2;
  const halfD = FIELD_DEPTH / 2;
  const n = Math.max(count, 1);
  const z = -halfD * 0.66 + halfD * 1.32 * ((index + 0.5) / n);
  // Anchor on the inner slope of the ridge (45 percent of the half width), where the label
  // stays inside the frame; ask side (+1) or bid side (-1).
  const d = 0.45;
  const x = side * halfW * d;
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const profile = smooth(0.05, 0.85, d) * (1 - 0.4 * smooth(0.78, 1, d));
  return { x, y: height * RIDGE_SCALE * profile, z };
}
