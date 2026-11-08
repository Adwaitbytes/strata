"use client";

import type { NetworkName, WsChannel, WsServerMessage } from "@strata/sdk";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StrataApiError } from "@/lib/api/client";
import { DATA_MODE } from "@/lib/env";
import { getStream } from "@/lib/stream-registry";
import type { StreamState } from "@/lib/stream";

/** Mock mode simulates a live feed by advancing a tick, so rank changes and rolls are visible in dev. */
const MOCK_TICK_MS = 4_000;

export interface LiveQueryOptions<T> {
  queryKey: QueryKey;
  network: NetworkName;
  fetcher: (ctx: { signal: AbortSignal; tick: number }) => Promise<T>;
  /** Stream channel that patches this query, if any. */
  channel?: WsChannel | undefined;
  apply?: ((prev: T, msg: WsServerMessage) => T) | undefined;
  /** Poll interval when no stream is available. */
  pollMs?: number | undefined;
  enabled?: boolean | undefined;
}

export function useLiveQuery<T>({ queryKey, network, fetcher, channel, apply, pollMs = 15_000, enabled = true }: LiveQueryOptions<T>) {
  const [tick, setTick] = useState(0);
  const qc = useQueryClient();

  useEffect(() => {
    if (DATA_MODE !== "mock" || !enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), MOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  const stream = getStream(network);
  const query = useQuery({
    queryKey: [...queryKey, DATA_MODE === "mock" ? tick : 0],
    queryFn: ({ signal }) => fetcher({ signal, tick }),
    enabled,
    placeholderData: (prev) => prev,
    refetchInterval: DATA_MODE === "live" && !(stream && channel) ? pollMs : false,
    retry: (count, err) => !(err instanceof StrataApiError && ["not_found", "unconfigured", "invalid_response"].includes(err.code)) && count < 3,
  });

  useEffect(() => {
    if (!stream || !channel || !apply || !enabled) return;
    return stream.subscribe(channel, (msg) => {
      qc.setQueryData<T>([...queryKey, 0], (prev) => (prev === undefined ? prev : apply(prev, msg)));
    });
    // queryKey is serialized by react-query; join keeps the effect stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, channel, enabled, qc, queryKey.join("|")]);

  return query;
}

const noop = () => () => undefined;

/** Connection state for the live indicator. Mock and unconfigured modes report their own state. */
export function useStreamState(network: NetworkName): StreamState | "mock" | "polling" {
  const stream = getStream(network);
  const state = useSyncExternalStore(
    stream ? (cb) => stream.onState(() => cb()) : noop,
    () => stream?.getState() ?? "idle",
    () => "idle" as StreamState,
  );
  if (DATA_MODE === "mock") return "mock";
  if (!stream) return "polling";
  return state;
}
