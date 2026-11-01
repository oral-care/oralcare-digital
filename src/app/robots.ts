import type { MetadataRoute } from "next";

// An internal tool: nothing is indexed (plan 12). Crawlers may fetch the pages
// so they see the noindex header and meta tag. A Disallow would hide the
// noindex, and a linked address could then show up as a bare URL.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
