import type { NetworkName } from "@strata/sdk";
import { API_BASE, DATA_MODE, wsUrl } from "@/lib/env";
import { StreamClient } from "@/lib/stream";

const clients = new Map<NetworkName, StreamClient>();

/** One shared socket per network in the browser. Null in mock or unconfigured mode, or on the server. */
export function getStream(network: NetworkName): StreamClient | null {
  if (typeof window === "undefined" || DATA_MODE !== "live" || !API_BASE) return null;
  let c = clients.get(network);
  if (!c) {
    c = new StreamClient(wsUrl(API_BASE), network, {
      createSocket: (url) => new WebSocket(url),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
    });
    clients.set(network, c);
  }
  return c;
}
