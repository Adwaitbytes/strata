"use client";

import type { ThemeName } from "@strata/ui/tokens";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onFirstInteraction } from "./defer";
import type { StrataLayout } from "./model";

const StrataCanvas = dynamic(() => import("@/components/three/StrataCanvas"), { ssr: false });

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
 * The 3D layer over the static poster (the poster itself is server markup in Hero, outside any
 * Suspense boundary, so it is in the first HTML and is the LCP image on phones). The hero
 * has its final shape before any JS runs. The WebGL chunk loads on first interaction (or a short
 * timer on capable desktops) and cross-fades in.
 * Reduced motion, no WebGL, or a phone that cannot hold 45 fps keep the poster.
 */
export function StrataStage({ layout }: { layout: StrataLayout }) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("poster");
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || !webglAvailable()) return;

    const start = () => setMode((m) => (m === "poster" ? "loading" : m));
    // Capable desktops also start on a short timer; phones wait for a touch or scroll so
    // WebGL setup never lands inside the load window on a slow CPU.
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
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: "120px" });
    // The wrapper is display: contents (no box), so watch the figure it sits in.
    io.observe(el.parentElement ?? el);
    const onVis = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const showCanvas = mode !== "poster";

  return (
    <div ref={root} className="contents">
      {showCanvas ? (
        <div className="strata-canvas absolute inset-0" data-ready={ready ? "" : undefined}>
          <StrataCanvas
            slabs={layout.slabs}
            theme={theme}
            active={visible && pageVisible}
            onReady={() => setReady(true)}
            onLowFps={() => {
              setReady(false);
              setMode("poster");
            }}
          />
        </div>
      ) : null}
      <StrataCaption
        live={layout.live}
        text={
          layout.live && !(showCanvas && ready)
            ? "Each layer is one market's depth within 25 bps of mid. Still image."
            : layout.caption
        }
      />
    </div>
  );
}

export function StrataCaption({ live, text }: { live: boolean; text: string }) {
  return (
    <figcaption className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 text-micro text-fg-subtle">
      <span
        aria-hidden
        className={live ? "size-1.5 rounded-full bg-accent" : "size-1.5 rounded-full border border-fg-subtle"}
      />
      {text}
    </figcaption>
  );
}
