/**
 * Imperative side of the terrain: everything that mutates three.js objects each frame lives
 * here, outside React, so components only wire inputs to it. Values are eased with
 * frame-rate-independent damping so scroll and data changes never jump.
 */
import { terrainScene, type ThemeName } from "@strata/ui/tokens";
import { MathUtils, Vector3, type Camera, type Color, type PerspectiveCamera, type ShaderMaterial } from "three";
import type { SurveyCamera } from "@/components/landing/survey-store";
import { MAX_RIDGES_GPU, ridgeCrest } from "./terrain-shader";

/** Fraction of the viewport width the desktop projection is shifted right. */
const VIEW_SHIFT = 0.2;
const LOW_FPS = 45;
/** Labels only appear right of this fraction of the viewport (the copy column is to its left). */
const LABEL_MIN_X = 0.52;

export interface TerrainTargets {
  heights: number[];
  shares: number[];
  count: number;
}

export interface FrameMonitor {
  frames: number;
  elapsed: number;
  strikes: number;
  ready: boolean;
}

export function createMonitor(): FrameMonitor {
  return { frames: 0, elapsed: 0, strikes: 0, ready: false };
}

function uniform<T>(material: ShaderMaterial, name: string): { value: T } {
  const u = material.uniforms[name];
  if (!u) throw new Error(`terrain shader has no uniform ${name}`);
  return u as { value: T };
}

export function applyTheme(material: ShaderMaterial, theme: ThemeName): void {
  const t = terrainScene[theme];
  uniform<Color>(material, "uFog").value.set(t.fog);
  uniform<Color>(material, "uRockLow").value.set(t.rockLow);
  uniform<Color>(material, "uRockHigh").value.set(t.rockHigh);
  uniform<Color>(material, "uContour").value.set(t.contour);
  uniform<Color>(material, "uStrata").value.set(t.strata);
  uniform<Color>(material, "uBid").value.set(t.bid);
  uniform<Color>(material, "uAsk").value.set(t.ask);
  uniform<Color>(material, "uFaultColor").value.set(t.fault);
  uniform<number>(material, "uContourAlpha").value = t.contourAlpha;
  uniform<number>(material, "uRim").value = t.rim;
  uniform<number>(material, "uGlow").value = theme === "dark" ? 1 : 0.7;
}

/** Desktop: shift the projection so the survey sits right of the copy column. */
export function applyViewShift(camera: PerspectiveCamera, width: number, height: number): void {
  if (width >= 1024) camera.setViewOffset(width, height, -width * VIEW_SHIFT, 0, width, height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

export function placeCamera(camera: Camera, at: SurveyCamera): void {
  camera.position.set(at.px, at.py, at.pz);
}

export interface FrameInput {
  material: ShaderMaterial;
  camera: Camera;
  survey: SurveyCamera;
  targets: TerrainTargets;
  pointer: { x: number; y: number };
  lookAt: Vector3;
  labels: readonly (HTMLElement | null)[];
  size: { width: number; height: number };
  elapsed: number;
  delta: number;
}

const scratch = new Vector3();

export function stepFrame({ material, camera, survey, targets, pointer, lookAt, labels, size, elapsed, delta }: FrameInput): void {
  const dt = Math.min(delta, 1 / 20);
  uniform<number>(material, "uTime").value = elapsed;
  uniform<number>(material, "uCount").value = Math.min(targets.count, MAX_RIDGES_GPU);

  const heights = uniform<number[]>(material, "uHeights").value;
  const shares = uniform<number[]>(material, "uShares").value;
  for (let i = 0; i < MAX_RIDGES_GPU; i++) {
    heights[i] = MathUtils.damp(heights[i] ?? 0, targets.heights[i] ?? 0, 2.4, dt);
    shares[i] = MathUtils.damp(shares[i] ?? 0, targets.shares[i] ?? 0, 2.4, dt);
  }
  const ease = (name: string, to: number) => {
    const u = uniform<number>(material, name);
    u.value = MathUtils.damp(u.value, to, 4, dt);
    return u.value;
  };
  const erode = ease("uErode", survey.erode);
  ease("uDeposit", survey.deposit);
  const fault = ease("uFault", survey.fault);
  const plan = ease("uPlan", survey.plan);
  const labelsOn = ease("uLabels", survey.labels);

  // A little pointer parallax: the land feels surveyed from a moving station.
  const px = survey.px + pointer.x * 0.6 * (1 - survey.plan);
  const py = survey.py - pointer.y * 0.35 * (1 - survey.plan);
  camera.position.x = MathUtils.damp(camera.position.x, px, 3.2, dt);
  camera.position.y = MathUtils.damp(camera.position.y, py, 3.2, dt);
  camera.position.z = MathUtils.damp(camera.position.z, survey.pz, 3.2, dt);
  lookAt.x = MathUtils.damp(lookAt.x, survey.tx, 3.2, dt);
  lookAt.y = MathUtils.damp(lookAt.y, survey.ty, 3.2, dt);
  lookAt.z = MathUtils.damp(lookAt.z, survey.tz, 3.2, dt);
  camera.lookAt(lookAt);

  // Pin each ridge label to its crest in screen space; labels fade once the story moves on.
  const fade = labelsOn * (1 - Math.min(1, erode * 2 + plan * 2 + fault));
  for (let i = 0; i < labels.length; i++) {
    const el = labels[i];
    if (!el) continue;
    // Pin to whichever crest (ask side first) is clear of the copy column and the viewport edge.
    let x = 0;
    let y = 0;
    let clear = false;
    for (const side of [1, -1] as const) {
      const crest = ridgeCrest(i, targets.count, heights[i] ?? 0, side);
      scratch.set(crest.x, crest.y, crest.z).project(camera);
      x = (scratch.x * 0.5 + 0.5) * size.width;
      y = (-scratch.y * 0.5 + 0.5) * size.height;
      clear = x > size.width * LABEL_MIN_X && x < size.width - 160 && y > 72 && y < size.height - 40;
      if (clear) break;
    }
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    el.style.opacity = clear ? fade.toFixed(3) : "0";
  }
}

/**
 * Frame-rate floor, sampled in one second windows after a two second warm-up. Returns "drop-dpr"
 * on the second slow window and "fallback" on the third, so callers can degrade in steps.
 */
export function checkFrameRate(m: FrameMonitor, delta: number, elapsed: number): "ok" | "drop-dpr" | "fallback" {
  m.frames += 1;
  m.elapsed += delta;
  if (m.elapsed < 1) return "ok";
  const rate = m.frames / m.elapsed;
  m.frames = 0;
  m.elapsed = 0;
  if (elapsed <= 2 || rate >= LOW_FPS) {
    m.strikes = 0;
    return "ok";
  }
  m.strikes += 1;
  if (m.strikes === 2) return "drop-dpr";
  if (m.strikes >= 3) return "fallback";
  return "ok";
}
