"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { onFirstInteraction } from "./defer";
import { SCENES, type SceneId } from "./scenes";

/**
 * Scroll narrative controller. The rail's active scene comes from IntersectionObserver, which
 * works with reduced motion too. When motion is allowed, GSAP ScrollTrigger, Lenis and anime.js
 * load after first paint (they are not in the first-load bundle) and add smooth scroll, the
 * rail progress line and SVG line drawing.
 */
export function StoryMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SceneId>("problem");

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const scenes = Array.from(el.querySelectorAll<HTMLElement>("[data-scene]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.getAttribute("data-scene") as SceneId);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    scenes.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let dispose: (() => void) | undefined;

    const load = () => void Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
      import("lenis"),
      import("animejs/animation"),
      import("animejs/svg"),
      import("animejs/utils"),
    ])
      .then(([{ gsap }, { ScrollTrigger }, { default: Lenis }, { animate }, { createDrawable }, { stagger }]) => {
        if (disposed) return;
        gsap.registerPlugin(ScrollTrigger);
        const lenis = new Lenis({ autoRaf: false, lerp: 0.12 });
        lenis.on("scroll", ScrollTrigger.update);
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);

        const triggers: ScrollTrigger[] = [];
        for (const scene of el.querySelectorAll<HTMLElement>("[data-scene]")) {
          const paths = scene.querySelectorAll<SVGGeometryElement>("[data-draw]");
          if (paths.length === 0) continue;
          const drawables = createDrawable(paths, 0, 0);
          triggers.push(
            ScrollTrigger.create({
              trigger: scene,
              start: "top 72%",
              once: true,
              onEnter: () => {
                animate(drawables, { draw: ["0 0", "0 1"], duration: 1100, ease: "inOutQuad", delay: stagger(140) });
              },
            }),
          );
        }
        triggers.push(
          ScrollTrigger.create({
            trigger: el,
            start: "top 55%",
            end: "bottom 55%",
            onUpdate: (self) => el.style.setProperty("--story-progress", self.progress.toFixed(4)),
          }),
        );

        dispose = () => {
          triggers.forEach((t) => t.kill());
          gsap.ticker.remove(tick);
          lenis.destroy();
        };
      })
      .catch((err: unknown) => {
        // Motion is progressive enhancement: the story stays fully readable without it.
        console.error("Landing motion failed to load", err);
      });
    const cancel = onFirstInteraction(load);

    return () => {
      disposed = true;
      cancel();
      dispose?.();
    };
  }, []);

  return (
    <div ref={root} className="story">
      <nav aria-label="Story sections" className="story-rail">
        <ol>
          {SCENES.map((s) => (
            <li key={s.id} data-active={s.id === active ? "" : undefined}>
              <a href={`#${s.id}`} aria-current={s.id === active ? "step" : undefined}>
                <span className="story-rail-layer" aria-hidden />
                <span className="story-rail-label">{s.rail}</span>
              </a>
            </li>
          ))}
        </ol>
        <span className="story-rail-progress" aria-hidden />
      </nav>
      <div className="story-scenes">{children}</div>
    </div>
  );
}
