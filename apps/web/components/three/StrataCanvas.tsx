"use client";

/**
 * The hero "liquidity strata": one translucent slab per market, thickness from live depth.
 * Geometry and the base glass material are authored in Blender (infra/blender/strata_hero.py)
 * and shipped as a Draco-compressed glb; this file only lays the slabs out and lights them.
 *
 * Loaded lazily by StrataStage after first paint, so nothing here is in the Landing's first-load JS.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Environment, Lightformer, PerformanceMonitor, useGLTF } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer } from "@react-three/postprocessing";
import { palette, strataScene, type ThemeName } from "@strata/ui/tokens";
import { Suspense, useMemo, useRef, useState } from "react";
import { MathUtils, MeshPhysicalMaterial, type BufferGeometry, type Group, type Mesh } from "three";
import type { StrataSlab } from "@/components/landing/model";

export const MODEL_URL = "/models/strata_hero.glb";
const DRACO_PATH = "/models/draco/";
const AUTHORED_LAYERS = 7;
const GAP = 0.075;
const MAX_DPR = 1.75;

export interface StrataCanvasProps {
  slabs: StrataSlab[];
  theme: ThemeName;
  /** False pauses the render loop (off-screen or tab hidden). */
  active: boolean;
  /** Mobile only: sustained frame rate under 45 fps hands back to the poster. */
  onLowFps: () => void;
  onReady: () => void;
}

type MaterialKind = StrataSlab["kind"];

function useMaterials(theme: ThemeName, base: MeshPhysicalMaterial | undefined): Record<MaterialKind, MeshPhysicalMaterial> {
  return useMemo(() => {
    const t = strataScene[theme];
    const make = (color: string, opacity: number, emissive: string, emissiveIntensity: number) => {
      const m = base ? base.clone() : new MeshPhysicalMaterial();
      m.color.set(color);
      m.emissive.set(emissive);
      m.emissiveIntensity = emissiveIntensity;
      // Real transmission costs a full extra render pass per frame; layered alpha reads the
      // same at this scale and keeps mid-range phones above the 45 fps floor.
      m.transmission = 0;
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.roughness = 0.2;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.08;
      m.envMapIntensity = theme === "dark" ? 1.1 : 0.8;
      return m;
    };
    return {
      neutral: make(t.glass, theme === "dark" ? 0.26 : 0.5, t.glass, 0.0),
      book: make(t.neutral, theme === "dark" ? 0.32 : 0.45, t.neutral, 0.02),
      strata: make(t.core, theme === "dark" ? 0.42 : 0.6, t.core, theme === "dark" ? 0.16 : 0.05),
    };
  }, [theme, base]);
}

function Stack({ slabs, theme, onReady }: Pick<StrataCanvasProps, "slabs" | "theme" | "onReady">) {
  const { nodes, materials } = useGLTF(MODEL_URL, DRACO_PATH);
  const geometries = useMemo(() => {
    const out: BufferGeometry[] = [];
    for (let i = 0; i < AUTHORED_LAYERS; i++) {
      const node = nodes[`Stratum_${String(i).padStart(2, "0")}`] as Mesh | undefined;
      if (node?.geometry) out.push(node.geometry);
    }
    return out;
  }, [nodes]);
  const authored = materials.StrataGlass instanceof MeshPhysicalMaterial ? materials.StrataGlass : undefined;
  const mats = useMaterials(theme, authored);
  const edgeColor = theme === "dark" ? strataScene.dark.core : strataScene.light.core;

  const group = useRef<Group>(null);
  const meshes = useRef<(Mesh | null)[]>([]);
  const readyFired = useRef(false);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (!readyFired.current) {
      readyFired.current = true;
      onReady();
    }
    g.rotation.y += delta * 0.06;
    // Thickness and position ease toward their targets, so live updates reshape the terrain
    // rather than jump.
    const total = slabs.reduce((s, l) => s + l.thickness, 0) + GAP * Math.max(0, slabs.length - 1);
    let y = -total / 2;
    const breathe = 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.04;
    slabs.forEach((slab, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      mesh.scale.y = MathUtils.damp(mesh.scale.y, slab.thickness, 3, delta);
      mesh.position.y = MathUtils.damp(mesh.position.y, y, 3, delta);
      y += slab.thickness + GAP * breathe;
    });
  });

  if (geometries.length === 0) return null;
  return (
    <group ref={group} rotation={[0, -0.6, 0]}>
      {slabs.map((slab, i) => (
        <mesh
          key={slab.key}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geometries[i % geometries.length]}
          material={mats[slab.kind]}
          scale={[1, 0.001, 1]}
          renderOrder={i}
        >
          <Edges
            threshold={65}
            color={slab.kind === "book" ? strataScene[theme].neutral : edgeColor}
            transparent
            opacity={slab.kind === "strata" ? 0.9 : 0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function StrataCanvas({ slabs, theme, active, onLowFps, onReady }: StrataCanvasProps) {
  const [dpr, setDpr] = useState(MAX_DPR);
  const [effects, setEffects] = useState(true);
  const isSmall = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const bloom = strataScene[theme].bloom;

  return (
    <Canvas
      dpr={[1, dpr]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [4.7, 2.5, 5.1], fov: 30, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <PerformanceMonitor
        bounds={() => [45, 60]}
        flipflops={2}
        onDecline={() => {
          if (isSmall) onLowFps();
          setEffects(false);
          setDpr(1.25);
        }}
        onFallback={() => {
          if (isSmall) onLowFps();
          setDpr(1);
        }}
      />
      {/* Solid page color: postprocessing drops canvas alpha, so the scene paints the canvas itself. */}
      <color attach="background" args={[palette[theme].bg]} />
      <ambientLight intensity={theme === "dark" ? 0.25 : 0.9} />
      <directionalLight position={[3, 5, 2]} intensity={theme === "dark" ? 1.4 : 1.8} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#cfffff" position={[2, 3, 3]} scale={[4, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#3ee6d4" position={[-3, 0.5, -2]} scale={[3, 2, 1]} />
        <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, -2, 3]} scale={2} />
      </Environment>
      <Suspense fallback={null}>
        <Stack slabs={slabs} theme={theme} onReady={onReady} />
      </Suspense>
      {effects ? (
        <EffectComposer multisampling={0}>
          <Bloom intensity={bloom} luminanceThreshold={0.78} luminanceSmoothing={0.15} mipmapBlur radius={0.55} />
          {isSmall || theme === "light" ? <></> : <DepthOfField focusDistance={0.012} focalLength={0.06} bokehScale={1.6} />}
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_PATH);
