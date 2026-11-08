/**
 * Tiny trend line for metric tiles. One series, 1.5px stroke, a faint area under it and a
 * dot on the latest point. Not interactive: the tile around it carries the number and the
 * tooltip. `label` is the screen-reader summary (a chart is never color or shape alone).
 */
export interface SparklineProps {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  /** CSS color; defaults to the accent token. */
  color?: string;
  className?: string | undefined;
}

export function sparkPath(values: readonly number[], width: number, height: number, pad = 2): { line: string; area: string; last: [number, number] | null } {
  if (values.length === 0) return { line: "", area: "", last: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i): [number, number] => [
    pad + i * stepX,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const area = `${line} L${last[0].toFixed(2)} ${height} L${first[0].toFixed(2)} ${height} Z`;
  return { line, area, last };
}

export function Sparkline({ values, label, width = 96, height = 28, color = "var(--accent)", className }: SparklineProps) {
  const { line, area, last } = sparkPath(values, width, height);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      style={{ overflow: "visible", color }}
    >
      {values.length < 2 ? (
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--border-strong)" strokeDasharray="2 3" />
      ) : (
        <>
          <path d={area} fill="currentColor" opacity={0.1} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          {last ? <circle cx={last[0]} cy={last[1]} r={2.25} fill="currentColor" /> : null}
        </>
      )}
    </svg>
  );
}
