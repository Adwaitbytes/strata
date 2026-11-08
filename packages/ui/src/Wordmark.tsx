import { useId, type SVGProps } from "react";
import { BRAND } from "./brand";
import { MONOGRAM, WORDMARK } from "./brand-geometry";

type MarkProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children"> & {
  /** Accessible name. Pass "" when the mark sits next to visible text that already names it. */
  title?: string;
};

/** The STRATA wordmark. Inherits `currentColor`; size it with height or width. */
export function Wordmark({ title = BRAND.name, ...props }: MarkProps) {
  const clipId = useId();
  const decorative = title === "";
  return (
    <svg
      viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
      fill="currentColor"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      {...props}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={WORDMARK.width} height={WORDMARK.seamTop} />
          <rect y={WORDMARK.seamBottom} width={WORDMARK.width} height={WORDMARK.height} />
        </clipPath>
      </defs>
      <path clipPath={`url(#${clipId})`} d={WORDMARK.d} />
    </svg>
  );
}

/** Square monogram: the seamed S. Uses `currentColor` for the glyph; the tile is transparent. */
export function Monogram({ title = BRAND.name, ...props }: MarkProps) {
  const clipId = useId();
  const decorative = title === "";
  return (
    <svg
      viewBox={`0 0 ${MONOGRAM.size} ${MONOGRAM.size}`}
      fill="currentColor"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      {...props}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={MONOGRAM.size} height={MONOGRAM.seamTop} />
          <rect y={MONOGRAM.seamBottom} width={MONOGRAM.size} height={MONOGRAM.size} />
        </clipPath>
      </defs>
      <path clipPath={`url(#${clipId})`} d={MONOGRAM.d} />
    </svg>
  );
}
