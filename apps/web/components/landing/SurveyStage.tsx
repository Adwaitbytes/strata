"use client";

import type { ThemeName } from "@strata/ui/tokens";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onFirstInteraction } from "./defer";
import { formatUsdCompact, type TerrainField } from "./model";
import { setTerrainMode } from "./survey-store";

const TerrainCanvas = dynamic(() => import("@/components/three/TerrainCanvas"), { ssr: false });

type Mode = "poster" | "loading" | "live";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function readTheme(): ThemeName {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribeTheme(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/**
 * The survey terrain behind the Landing. A fixed stage that the hero and the story scroll over.
 * The still poster is a CSS background in the first HTML, so the page has its final look before
 * any JS. The WebGL chunk loads on first interaction (or a short timer on capable desktops) and
 * cross-fades in. Reduced motion, no WebGL, or a phone that cannot hold 45 fps keep the poster.
 * Rendering stops when the tab is hidden or the reader has scrolled past the story.
 */
export function SurveyStage({ field }: { field: TerrainField }) {
  const [mode, setMode] = useState<Mode>("poster");
  const [ready, setReady] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [past, setPast] = useState(false);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || !webglAvailable()) return;
    const start = () => setMode((m) => (m === "poster" ? "loading" : m));
    // Capable desktops also start on a timer; phones wait for a touch or scroll so WebGL setup
    // never lands inside the load window on a slow CPU.
    const capable = window.matchMedia("(min-width: 1024px)").matches && (navigator.hardwareConcurrency ?? 4) > 4;
    const cancel = onFirstInteraction(start, capable ? 4500 : undefined);
    const onReduce = () => {
      if (reduced.matches) setMode("poster");
    };
    reduced.addEventListener("change", onReduce);
    return () => {
      cancel();
      reduced.removeEventListener("change", onReduce);
    };
  }, []);

  useEffect(() => {
    const onVis = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    const end = document.querySelector("[data-survey-end]");
    const io = end
      ? new IntersectionObserver(([e]) => setPast(Boolean(e && !e.isIntersecting && e.boundingClientRect.top < 0)))
      : null;
    if (end) io?.observe(end);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  const live = mode !== "poster" && ready;
  useEffect(() => setTerrainMode(live ? "live" : "poster"), [live]);

  return (
    <div className="survey-stage" data-past={past ? "" : undefined} data-live={live ? "" : undefined} aria-hidden>
      <div className="survey-poster" />
      {mode !== "poster" ? (
        <div className="survey-canvas">
          <TerrainCanvas
            ridges={field.ridges}
            theme={theme}
            active={pageVisible && !past}
            labels={labels}
            onReady={() => setReady(true)}
            onLowFps={() => {
              setReady(false);
              setMode("poster");
            }}
          />
        </div>
      ) : null}
      {field.live ? (
        <div className="survey-labels">
          {field.ridges.map((r, i) => (
            <div
              key={r.key}
              ref={(el) => {
                labels.current[i] = el;
              }}
              className="ridge-label"
            >
              <span className="ridge-label-mark" />
              <span className="ridge-label-text">
                <span className="text-fg">{r.symbol}</span>
                <span className="num">{formatUsdCompact(r.depthUsd25)}</span>
                {r.strataShare > 0 ? <span className="num text-accent">STRATA {Math.round(r.strataShare * 100)}%</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
