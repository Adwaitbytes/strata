import type { CSSProperties } from "react";

/**
 * Layout-matched placeholder block. Size it exactly like the content it stands in for so
 * nothing shifts when data arrives. The shimmer is a CSS animation named `strata-shimmer`
 * defined by the app stylesheet; reduced motion stops it.
 */
export function Skeleton({ className, style }: { className?: string | undefined; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "block",
        borderRadius: 6,
        background:
          "linear-gradient(90deg, var(--surface-hover) 0%, color-mix(in srgb, var(--surface-hover) 60%, var(--border-strong)) 50%, var(--surface-hover) 100%)",
        backgroundSize: "200% 100%",
        animation: "strata-shimmer 1.6s ease-in-out infinite",
        ...style,
      }}
    />
  );
}
