/**
 * Content-Security-Policy builder. Pure so it can be unit tested.
 *
 * Scripts: nonce + 'strict-dynamic', no 'unsafe-inline', no third-party script origins.
 * 'wasm-unsafe-eval' lets the landing 3D decoders (Draco/KTX2, W8) compile WebAssembly
 * without allowing JavaScript eval. Styles allow inline attributes because Motion and the
 * chart library write element.style; style injection cannot execute script.
 */
export interface CspInput {
  nonce: string;
  isDev: boolean;
  /** Origins the browser may call for data: the STRATA API (http and ws) and EVM RPCs. */
  connectOrigins: readonly string[];
}

export function buildCsp({ nonce, isDev, connectOrigins }: CspInput): string {
  const connect = ["'self'", ...new Set(connectOrigins)];
  if (isDev) connect.push("ws://localhost:*", "ws://127.0.0.1:*");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Converts an http(s) API base into the origins CSP must allow (http and ws variants). */
export function apiOrigins(apiBase: string | undefined): string[] {
  if (!apiBase) return [];
  try {
    const u = new URL(apiBase);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return [u.origin, `${wsProto}//${u.host}`];
  } catch {
    return [];
  }
}
