// Headers sent on every route, including /api (plan 12). The CSP is not here:
// it needs a fresh nonce per request and is set in src/proxy.ts.
export const securityHeaders = [
  // Two years of HTTPS, no preload, as on oralcare.se.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), display-capture=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // An internal tool: never indexed.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
