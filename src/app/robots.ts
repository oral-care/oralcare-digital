import type { MetadataRoute } from "next";

// An internal tool: nothing is indexed (plan 12).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
