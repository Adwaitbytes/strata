import createMDX from "@next/mdx";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers that do not depend on the request. The Content-Security-Policy header is
 * per-request (it carries a nonce) and is set in proxy.ts.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ["ts", "tsx", "mdx"],
  transpilePackages: ["@strata/ui"],
  // Monorepo root, so docs/*.md (rendered by /docs/[slug]) can be traced into the server bundle.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
  outputFileTracingIncludes: { "/docs/[slug]": ["../../docs/*.md"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withMDX = createMDX({
  options: {
    // Turbopack needs plugin names as strings so the options stay serializable.
    remarkPlugins: [["remark-gfm", {}]],
  },
});

export default withMDX(nextConfig);
