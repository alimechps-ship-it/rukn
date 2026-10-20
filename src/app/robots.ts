import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
