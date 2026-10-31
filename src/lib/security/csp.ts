// The Content-Security-Policy, built per request with a fresh nonce (plan 12).
// Next.js reads the nonce from this header and adds it to its own scripts, and
// 'strict-dynamic' lets those scripts load the rest. Styles allow inline because
// Radix and the charts set style attributes at runtime.
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  // React's dev tooling needs eval; production never gets it.
  if (development) scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}
