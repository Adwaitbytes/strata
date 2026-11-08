"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { onFirstInteraction } from "./defer";
import { SCENES, type SceneId } from "./scenes";
import { setActiveStage, STAGES, surveyCamera, type StageId } from "./survey-store";

/**
 * Scroll narrative controller. The rail's active station comes from IntersectionObserver, which
 * works with reduced motion too. When motion is allowed, GSAP (ScrollTrigger, SplitText), Lenis
 * and anime.js load on first interaction (they are not in the first-load bundle) and add smooth
 * scroll, the camera flight between stations, title reveals and SVG line drawing.
 */
export function StoryMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SceneId | null>(null);

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
    // Above the first station the camera is back over the hero survey.
    const top = new IntersectionObserver(([e]) => {
      if (e && !e.isIntersecting && e.boundingClientRect.top > 0) setActive(null);
    });
    top.observe(el);
    return () => {
      io.disconnect();
      top.disconnect();
    };
  }, []);

  useEffect(() => setActiveStage(active ?? "hero"), [active]);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let dispose: (() => void) | undefined;

    const load = () =>
      void Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("gsap/SplitText"),
        import("lenis"),
        import("animejs/animation"),
        import("animejs/svg"),
        import("animejs/utils"),
      ])
        .then(([{ gsap }, { ScrollTrigger }, { SplitText }, { default: Lenis }, { animate }, { createDrawable }, { stagger }]) => {
          if (disposed) return;
          gsap.registerPlugin(ScrollTrigger, SplitText);
          const lenis = new Lenis({ autoRaf: false, lerp: 0.11 });
          lenis.on("scroll", ScrollTrigger.update);
          const tick = (time: number) => lenis.raf(time * 1000);
          gsap.ticker.add(tick);
          gsap.ticker.lagSmoothing(0);

          // Camera flight: each station tweens the shared survey state; the canvas eases toward it.
          const fly = (stage: StageId) =>
            gsap.to(surveyCamera, { ...STAGES[stage], duration: 2.1, ease: "power3.inOut", overwrite: "auto" });

          const triggers: ScrollTrigger[] = [];
          const splits: SplitText[] = [];
          triggers.push(
            ScrollTrigger.create({
              trigger: el,
              start: "top 55%",
              onLeaveBack: () => fly("hero"),
            }),
          );

          for (const scene of el.querySelectorAll<HTMLElement>("[data-scene]")) {
            const id = scene.dataset.scene as SceneId;
            const title = scene.querySelector<HTMLElement>("[data-reveal]");
            const split = title ? SplitText.create(title, { type: "lines", mask: "lines", linesClass: "reveal-line" }) : null;
            if (split) {
              splits.push(split);
              gsap.set(split.lines, { yPercent: 105 });
            }
            const paths = scene.querySelectorAll<SVGGeometryElement>("[data-draw]");
            const drawables = paths.length > 0 ? createDrawable(paths, 0, 0) : null;
            let revealed = false;

            triggers.push(
              ScrollTrigger.create({
                trigger: scene,
                start: "top 60%",
                end: "bottom 40%",
                onToggle: (self) => {
                  if (self.isActive) fly(id);
                },
                onEnter: () => {
                  if (revealed) return;
                  revealed = true;
                  if (split) gsap.to(split.lines, { yPercent: 0, duration: 1.1, ease: "expo.out", stagger: 0.09 });
                  if (drawables) animate(drawables, { draw: ["0 0", "0 1"], duration: 1200, ease: "inOutQuad", delay: stagger(140) });
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
            splits.forEach((s) => s.revert());
            gsap.killTweensOf(surveyCamera);
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
      <nav aria-label="Story stations" className="story-rail">
        <ol>
          {SCENES.map((s, i) => (
            <li key={s.id} data-active={s.id === active ? "" : undefined}>
              <a href={`#${s.id}`} aria-current={s.id === active ? "step" : undefined}>
                <span className="story-rail-index num" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
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
