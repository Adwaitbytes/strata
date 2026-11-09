import { describe, expect, it } from "vitest";
import { buildApp } from "../src/create-app.js";
import { PUBLIC_ROUTES } from "../src/routes/table.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";

describe("OpenAPI", () => {
  it("publishes a 3.x document covering every public route, the stream and admin", async () => {
    const app = await buildApp({ config: testConfig(), repo: new MemoryRepo() });
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toMatch(/^3\./);
    for (const r of PUBLIC_ROUTES) {
      const path = r.path.replace(/:([a-z]+)/g, "{$1}");
      expect(doc.paths[path]?.["get"], path).toBeDefined();
    }
    expect(doc.paths["/v1/admin/kill"]?.["post"]).toBeDefined();
    expect(doc.paths["/v1/stream/sse"]?.["get"]).toBeDefined();
    await app.close();
  });

  it("serves a script-free docs page at /docs that lists every public route", async () => {
    const app = await buildApp({ config: testConfig(), repo: new MemoryRepo() });
    for (const url of ["/docs", "/docs/"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(res.headers["content-security-policy"]).toContain("script-src 'none'");
      expect(res.body).not.toContain("<script");
      for (const r of PUBLIC_ROUTES) expect(res.body).toContain(r.path.replace(/:([a-z]+)/g, "{$1}"));
    }
    await app.close();
  });

  it("escapes document text in the docs page", async () => {
    const { renderDocsPage } = await import("../src/openapi.js");
    const html = renderDocsPage({ openapi: "3.0.3", info: { title: "<b>x</b>", version: "1" }, paths: {} });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});
