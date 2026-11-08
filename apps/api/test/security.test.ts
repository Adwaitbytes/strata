import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { ApiError } from "@strata/sdk";
import { buildApp } from "../src/create-app.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";
import { NOW } from "./support/fixtures.js";

describe("security headers", () => {
  it("sends CSP with frame-ancestors none, HSTS and nosniff", async () => {
    const app = await buildApp({ config: testConfig(), repo: new MemoryRepo(), now: () => NOW });
    const res = await app.inject({ method: "GET", url: "/v1/markets?network=testnet" });
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    await app.close();
  });
});

describe("CORS allow-list", () => {
  it("echoes an allowed origin and omits the header for others", async () => {
    const app = await buildApp({ config: testConfig({ CORS_ORIGINS: "https://strata.example" }), repo: new MemoryRepo(), now: () => NOW });
    const ok = await app.inject({ method: "GET", url: "/v1/stats?network=testnet", headers: { origin: "https://strata.example" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://strata.example");
    const bad = await app.inject({ method: "GET", url: "/v1/stats?network=testnet", headers: { origin: "https://evil.example" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});

describe("rate limiting", () => {
  it("returns 429 in the ApiError shape once the per-IP budget is spent", async () => {
    const app = await buildApp({ config: testConfig({ RATE_LIMIT_MAX: "2" }), repo: new MemoryRepo(), now: () => NOW });
    const hit = () => app.inject({ method: "GET", url: "/v1/agents?network=testnet", remoteAddress: "203.0.113.9" });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(ApiError.parse(limited.json()).error.code).toBe("rate_limited");
    const other = await app.inject({ method: "GET", url: "/v1/agents?network=testnet", remoteAddress: "203.0.113.10" });
    expect(other.statusCode).toBe(200);
    await app.close();
  });
});

describe("request logging", () => {
  it("never writes the client IP or headers to the log", async () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const app = await buildApp({ config: testConfig({ LOG_LEVEL: "info" }), repo: new MemoryRepo(), now: () => NOW, logStream: sink });
    await app.inject({ method: "GET", url: "/v1/agents?network=testnet", remoteAddress: "198.51.100.77", headers: { "user-agent": "secret-agent" } });
    await app.close();
    const log = lines.join("");
    expect(log).toContain("/v1/agents");
    expect(log).not.toContain("198.51.100.77");
    expect(log).not.toContain("secret-agent");
  });
});

describe("body limits", () => {
  it("rejects oversized JSON bodies without echoing them", async () => {
    const app = await buildApp({ config: testConfig(), repo: new MemoryRepo(), now: () => NOW });
    const res = await app.inject({ method: "POST", url: "/v1/admin/kill", headers: { "content-type": "application/json" }, payload: JSON.stringify({ pad: "x".repeat(40_000) }) });
    expect(res.statusCode).toBe(413);
    expect(ApiError.parse(res.json()).error.code).toBe("bad_request");
    await app.close();
  });
});

describe("proxy trust", () => {
  it("keys rate limits on the proxy-appended address, not a spoofed X-Forwarded-For prefix", async () => {
    const app = await buildApp({ config: testConfig({ RATE_LIMIT_MAX: "1", TRUST_PROXY: "true" }), repo: new MemoryRepo(), now: () => NOW });
    const hit = (spoof: string) =>
      app.inject({ method: "GET", url: "/v1/agents?network=testnet", remoteAddress: "10.0.0.1", headers: { "x-forwarded-for": `${spoof}, 198.51.100.1` } });
    expect((await hit("1.1.1.1")).statusCode).toBe(200);
    expect((await hit("2.2.2.2")).statusCode).toBe(429);
    await app.close();
  });
});
