import type { CSSProperties } from "react";

/**
 * Rolling number for live values. Each digit is a vertical strip of 0 to 9 translated to the
 * current digit, so a changing value animates without changing width (tabular figures keep
 * every strip the same width). Digits are keyed from the right so place values keep identity.
 * Motion is a CSS transition, which the global reduced-motion rule collapses to an instant swap.
 * Screen readers get the plain string once.
 */
const LINE = "1.2em";

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Digit({ value }: { value: number }) {
  return (
    <span style={{ display: "inline-block", height: LINE, overflow: "hidden", verticalAlign: "top" }}>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          transform: `translateY(calc(${-value} * ${LINE}))`,
          transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} style={{ height: LINE, lineHeight: LINE }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export interface NumberRollProps {
  /** Already-formatted value, for example "$25.4K" or "8,412". */
  value: string;
  className?: string | undefined;
}

export function NumberRoll({ value, className }: NumberRollProps) {
  const chars = Array.from(value);
  return (
    <span className={className} style={{ position: "relative", display: "inline-flex", fontVariantNumeric: "tabular-nums" }}>
      <span style={srOnly}>{value}</span>
      <span aria-hidden="true" style={{ display: "inline-flex", height: LINE, lineHeight: LINE }}>
        {chars.map((ch, i) => {
          const place = chars.length - i;
          return /\d/.test(ch) ? (
            <Digit key={`d${place}`} value={Number(ch)} />
          ) : (
            <span key={`c${place}${ch}`} style={{ height: LINE, lineHeight: LINE, whiteSpace: "pre" }}>
              {ch === " " ? "\u00a0" : ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}
