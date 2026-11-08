"use client";

import { animate } from "motion/mini";
import Link from "next/link";
import { useRef, type PointerEvent, type ReactNode } from "react";

const PULL = 0.22;
const MAX = 8;

/**
 * A call to action that leans a few pixels toward a fine pointer, then settles back with a
 * spring when the pointer leaves. Touch, coarse pointers and reduced motion get a plain link.
 * `motion/mini` is the WAAPI build of Motion, so this costs a couple of KB on the Landing.
 */
export function MagneticLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);

  const allowed = () =>
    window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: PointerEvent<HTMLAnchorElement>) => {
    const el = ref.current;
    if (!el || !allowed()) return;
    const r = el.getBoundingClientRect();
    const dx = Math.max(-MAX, Math.min(MAX, (e.clientX - (r.left + r.width / 2)) * PULL));
    const dy = Math.max(-MAX, Math.min(MAX, (e.clientY - (r.top + r.height / 2)) * PULL));
    animate(el, { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` }, { duration: 0.18, ease: [0.22, 1, 0.36, 1] });
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    animate(el, { transform: "translate(0px, 0px)" }, { type: "spring", stiffness: 420, damping: 22 });
  };

  return (
    <Link ref={ref} href={href} className={className} onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
    </Link>
  );
}
