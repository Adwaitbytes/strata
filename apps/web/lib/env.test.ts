import { describe, expect, it } from "vitest";
import { resolveDataMode, wsUrl } from "./env";
import { apiOrigins, buildCsp } from "./csp";

describe("data mode", () => {
  it("is live whenever an API is configured", () => {
    expect(resolveDataMode("https://api.example.com", "production")).toBe("live");
  });
  it("never falls back to mock in production", () => {
    expect(resolveDataMode(null, "production")).toBe("unconfigured");
  });
  it("uses mock data in development without an API", () => {
    expect(resolveDataMode(null, "development")).toBe("mock");
  });
  it("derives the websocket URL", () => {
    expect(wsUrl("https://api.example.com")).toBe("wss://api.example.com/v1/stream");
    expect(wsUrl("http://localhost:4000")).toBe("ws://localhost:4000/v1/stream");
  });
});

describe("csp", () => {
  const csp = buildCsp({ nonce: "abc", isDev: false, connectOrigins: apiOrigins("https://api.example.com") });
  it("uses a nonce and strict-dynamic without unsafe-inline scripts", () => {
    const script = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain(" 'unsafe-eval'");
  });
  it("allows the API over https and wss only", () => {
    expect(csp).toContain("connect-src 'self' https://api.example.com wss://api.example.com");
  });
  it("blocks framing and plugins", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
