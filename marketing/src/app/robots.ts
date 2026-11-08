import type { MetadataRoute } from "next"
import { SITE } from "@/config/site"

export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: SITE.indexable
      ? { userAgent: "*", allow: "/" }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${SITE.url}/sitemap.xml`,
  }
}
