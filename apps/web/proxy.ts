import { NETWORKS } from "@strata/config";
import { NextResponse, type NextRequest } from "next/server";
import { apiOrigins, buildCsp } from "@/lib/csp";

const RPC_ORIGINS = Object.values(NETWORKS).flatMap((n) => n.evm.rpcUrls.map((u) => new URL(u).origin));

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    connectOrigins: [...apiOrigins(process.env.NEXT_PUBLIC_STRATA_API), ...RPC_ORIGINS],
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|models/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
