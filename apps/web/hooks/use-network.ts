"use client";

import type { NetworkName } from "@strata/sdk";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Testnet is the default view: it is where STRATA runs today (D27). Mainnet is one click away. */
export const DEFAULT_NETWORK: NetworkName = "testnet";

export function parseNetwork(value: string | null | undefined): NetworkName {
  return value === "mainnet" ? "mainnet" : DEFAULT_NETWORK;
}

export function useNetwork(): [NetworkName, (n: NetworkName) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const network = parseNetwork(params.get("network"));
  const setNetwork = useCallback(
    (n: NetworkName) => {
      const next = new URLSearchParams(params.toString());
      if (n === DEFAULT_NETWORK) next.delete("network");
      else next.set("network", n);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [network, setNetwork];
}
