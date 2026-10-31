import type { NextConfig } from "next";

import { assertProductionEnvironment } from "./src/lib/env";
import { securityHeaders } from "./src/lib/security/headers";

// A production build on Vercel stops when a variable is missing or wrong, or
// when Neon's own variables are present (plan 10.4 and 12).
if (process.env.VERCEL_ENV === "production") assertProductionEnvironment();

const nextConfig: NextConfig = {
  // Every page renders per request, since the CSP nonce needs it (plan 12).
  // Cache Components would prerender a static shell whose scripts carry no nonce.
  // Same as oralcare.se: the React Compiler only in production builds, since it
  // makes the Turbopack dev server very memory-heavy.
  reactCompiler: process.env.NODE_ENV === "production",
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  // Headers that don't depend on the request. The CSP with a nonce is set per
  // request in src/proxy.ts.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses are never rendered, so they get the strictest policy.
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
