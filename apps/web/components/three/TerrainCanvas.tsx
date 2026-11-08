"use client";

/**
 * The live survey terrain: a procedural heightfield whose ridges are market depth from
 * /v1/stats (see terrain-shader.ts for the drawing rules). The camera follows `surveyCamera`,
 * which the scroll narrative tweens; this component only eases toward it.
 *
 * Loaded lazily by SurveyStage after first paint, so nothing here is in the Landing's first-load JS.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { terrainScene, type ThemeName } from "@strata/ui/tokens";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Color, PlaneGeometry, ShaderMaterial, Vector3, type PerspectiveCamera } from "three";
import type { TerrainRidge } from "@/components/landing/model";
import { surveyCamera } from "@/components/landing/survey-store";
import { applyTheme, applyViewShift, checkFrameRate, createMonitor, placeCamera, stepFrame } from "./terrain-driver";
import { FIELD_DEPTH, FIELD_WIDTH, MAX_RIDGES_GPU, terrainFragment, terrainVertex } from "./terrain-shader";

const MAX_DPR = 1.75;

export interface TerrainCanvasProps {
  ridges: TerrainRidge[];
  theme: ThemeName;
  /** False pauses the render loop (off-screen, tab hidden, or past the story). */
  active: boolean;
  /** Ridge labels positioned over the canvas, one per ridge, in ridge order. */
  labels: RefObject<(HTMLElement | null)[]>;
  /** Small screens: a sustained frame rate under 45 fps hands back to the poster. */
  onLowFps: () => void;
  onReady: () => void;
}

function padded(values: number[]): number[] {
  return Array.from({ length: MAX_RIDGES_GPU }, (_, i) => values[i] ?? 0);
}

function Terrain({ ridges, theme, labels, onReady, onLowFps, compact }: Omit<TerrainCanvasProps, "active"> & { compact: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const setDpr = useThree((s) => s.setDpr);

  const geometry = useMemo(() => {
    const g = new PlaneGeometry(FIELD_WIDTH, FIELD_DEPTH, compact ? 150 : 260, compact ? 96 : 168);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [compact]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: terrainVertex,
        fragmentShader: terrainFragment,
        uniforms: {
          uTime: { value: 0 },
          uErode: { value: 0 },
          uDeposit: { value: 0 },
          uFault: { value: 0 },
          uPlan: { value: 0 },
          // Not read by the shader: the driver eases label visibility through the same damping.
          uLabels: { value: 1 },
          uHeights: { value: padded([]) },
          uShares: { value: padded([]) },
          uCount: { value: 0 },
          uFog: { value: new Color() },
          uRockLow: { value: new Color() },
          uRockHigh: { value: new Color() },
          uContour: { value: new Color() },
          uStrata: { value: new Color() },
          uBid: { value: new Color() },
          uAsk: { value: new Color() },
          uFaultColor: { value: new Color() },
          uContourAlpha: { value: 0.2 },
          uRim: { value: 0.5 },
          uFogDensity: { value: 0.062 },
          uGlow: { value: 1 },
        },
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => applyTheme(material, theme), [theme, material]);
  useEffect(() => applyViewShift(camera, size.width, size.height), [camera, size.width, size.height]);

  // Heights ease toward live values so a data refresh reshapes the land instead of jumping.
  const targets = useMemo(
    () => ({ heights: padded(ridges.map((r) => r.height)), shares: padded(ridges.map((r) => r.strataShare)), count: ridges.length }),
    [ridges],
  );

  const lookAt = useRef(new Vector3(surveyCamera.tx, surveyCamera.ty, surveyCamera.tz));
  const pointer = useRef({ x: 0, y: 0 });
  const monitor = useRef(createMonitor());

  useEffect(() => {
    placeCamera(camera, surveyCamera);
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX / window.innerWidth - 0.5, y: e.clientY / window.innerHeight - 0.5 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [camera]);

  useFrame((state, delta) => {
    stepFrame({
      material,
      camera: state.camera,
      survey: surveyCamera,
      targets,
      pointer: pointer.current,
      lookAt: lookAt.current,
      labels: labels.current ?? [],
      size: state.size,
      elapsed: state.clock.elapsedTime,
      delta,
    });
    const m = monitor.current;
    if (!m.ready) {
      m.ready = true;
      onReady();
    }
    const rate = checkFrameRate(m, delta, state.clock.elapsedTime);
    if (rate === "drop-dpr") setDpr(1);
    if (rate === "fallback" && compact) onLowFps();
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export default function TerrainCanvas({ active, ...props }: TerrainCanvasProps) {
  const [compact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  return (
    <Canvas
      dpr={[1, MAX_DPR]}
      flat
      frameloop={active ? "always" : "never"}
      camera={{ position: [surveyCamera.px, surveyCamera.py, surveyCamera.pz], fov: compact ? 42 : 32, near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      aria-hidden
    >
      <color attach="background" args={[terrainScene[props.theme].fog]} />
      <Terrain {...props} compact={compact} />
    </Canvas>
  );
}
