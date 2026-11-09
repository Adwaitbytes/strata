import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Vercel's Node launcher imports the entrypoint after replacing http.Server.prototype.listen
 * with a stub that records the server and never invokes the listen callback. If the module
 * awaits listen at top level, the import never settles and every request times out
 * (INTERNAL_FUNCTION_INVOCATION_FAILED). Source: @vercel/node serverless handler,
 * compileUserCode (vercel CLI 64.0.2).
 */
describe("entrypoint under the Vercel launcher", () => {
  const originalListen = http.Server.prototype.listen;

  afterEach(() => {
    http.Server.prototype.listen = originalListen;
    vi.unstubAllEnvs();
  });

  it("finishes importing and hands its http.Server to the launcher", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("PORT", "18787");
    vi.stubEnv("HOST", "127.0.0.1");
    vi.stubEnv("LOG_LEVEL", "silent");
    let captured: http.Server | null = null;
    http.Server.prototype.listen = function (this: http.Server) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test exists to capture the server instance the entrypoint creates.
      captured = this;
      http.Server.prototype.listen = originalListen;
      return this;
    } as typeof http.Server.prototype.listen;

    const imported = import("../src/index.js").then(() => "imported" as const);
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000));
    expect(await Promise.race([imported, timeout])).toBe("imported");

    // The launcher waits up to 1s after import for listen to be called.
    await vi.waitFor(() => expect(captured).toBeInstanceOf(http.Server), { timeout: 1_000 });
  });
});
