/**
 * Soak finding (2026-11-09): an agent died on `Error: read ECONNRESET at TLSWrap.onStreamRead`
 * raised as an unhandled rejection. postgres.js 3.4.9 starts its array-type lookup on every new
 * connection without attaching a handler (connection.js `return fetchArrayTypes()`), so a reset
 * while that lookup is in flight escaped every caller. These tests drive a real postgres.js pool
 * against a fake server that resets the socket at that moment.
 */
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.js";

function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
const authOk = () => message("R", Buffer.from([0, 0, 0, 0]));
const ready = () => message("Z", Buffer.from("I"));

/** Accepts the startup handshake, then resets the TCP connection on the first query. */
function resetOnFirstQuery(): Promise<{ server: Server; url: string; resets: () => number }> {
  let resets = 0;
  const server = createServer((socket: Socket) => {
    let started = false;
    socket.on("error", () => undefined);
    socket.on("data", () => {
      if (!started) {
        started = true;
        socket.write(Buffer.concat([authOk(), ready()]));
        return;
      }
      resets++;
      socket.resetAndDestroy();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, url: `postgres://u:p@127.0.0.1:${port}/db?sslmode=disable`, resets: () => resets });
    });
  });
}

describe("createDb under connection resets", () => {
  let server: Server | null = null;
  let handle: DbHandle | null = null;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => void unhandled.push(reason);

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
    await handle?.close().catch(() => undefined);
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    handle = null;
    server = null;
  });

  it("rejects the caller's query and leaks no unhandled rejection when the socket resets during the type lookup", async () => {
    process.on("unhandledRejection", onUnhandled);
    const fake = await resetOnFirstQuery();
    server = fake.server;
    handle = createDb(fake.url, { max: 1 });
    await expect(handle.sql`select 1`).rejects.toMatchObject({ code: "ECONNRESET" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.resets()).toBeGreaterThan(0);
    expect(unhandled).toEqual([]);
  });
});
