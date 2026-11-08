/**
 * Shared state between the scroll narrative (GSAP writes) and the terrain canvas (reads every
 * frame). A plain mutable object, not React state: the camera moves at 60 fps and must never
 * cause a render. The active scene is a small external store so the HUD caption can follow it.
 */
import type { SceneId } from "./scenes";

export interface SurveyCamera {
  /** Camera position. */
  px: number;
  py: number;
  pz: number;
  /** Point the camera looks at. */
  tx: number;
  ty: number;
  tz: number;
  /** 0 = live terrain; 1 = eroded flat land (thin books). */
  erode: number;
  /** 0 to 1: illustrative depth deposited near the mid (agents quoting). */
  deposit: number;
  /** 0 to 1: a fault line throws one side of the terrain and freezes its drift (guards). */
  fault: number;
  /** 0 to 1: blends the camera toward a top-down survey sheet. */
  plan: number;
}

export type StageId = "hero" | SceneId;

/** Camera and terrain uniforms for each stop of the story. Tuned against screenshots. */
export const STAGES: Record<StageId, SurveyCamera> = {
  hero: { px: 1.2, py: 7, pz: 12.5, tx: 0.2, ty: 0.3, tz: 0.4, erode: 0, deposit: 0, fault: 0, plan: 0 },
  problem: { px: -2.5, py: 1.15, pz: 7.4, tx: -1.2, ty: 0.25, tz: 0, erode: 1, deposit: 0, fault: 0, plan: 0 },
  arena: { px: 5.6, py: 3.1, pz: 6.2, tx: -0.6, ty: 0.3, tz: 0, erode: 0.6, deposit: 1, fault: 0, plan: 0 },
  guards: { px: -6.4, py: 5.2, pz: 2.4, tx: -0.4, ty: 0, tz: 0.4, erode: 0.2, deposit: 0.25, fault: 1, plan: 0 },
  proof: { px: -1.4, py: 0.9, pz: 9.6, tx: -1.4, ty: 0.55, tz: 0, erode: 0, deposit: 0, fault: 0, plan: 0 },
  join: { px: -1.6, py: 11.5, pz: 0.6, tx: -1.6, ty: 0, tz: 0, erode: 0, deposit: 0, fault: 0, plan: 1 },
};

export const surveyCamera: SurveyCamera = { ...STAGES.hero };

/** What the terrain is showing at each stage. Illustrative stages say so. */
export const STAGE_TRUTH: Record<StageId, "data" | "illustration"> = {
  hero: "data",
  problem: "illustration",
  arena: "illustration",
  guards: "illustration",
  proof: "data",
  join: "data",
};

let activeStage: StageId = "hero";
const listeners = new Set<() => void>();

export function setActiveStage(stage: StageId): void {
  if (stage === activeStage) return;
  activeStage = stage;
  listeners.forEach((l) => l());
}

export function getActiveStage(): StageId {
  return activeStage;
}

export function subscribeStage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the visitor is seeing the still poster or the live terrain. Captions read this. */
export type TerrainMode = "poster" | "live";

let terrainMode: TerrainMode = "poster";
const modeListeners = new Set<() => void>();

export function setTerrainMode(mode: TerrainMode): void {
  if (mode === terrainMode) return;
  terrainMode = mode;
  modeListeners.forEach((l) => l());
}

export function getTerrainMode(): TerrainMode {
  return terrainMode;
}

export function subscribeTerrainMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}
