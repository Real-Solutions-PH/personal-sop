import type { MetadataRoute } from "next"
import { SITE } from "@/config/site"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE.indexable) return []
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/research/`, changeFrequency: "monthly", priority: 0.5 },
  ]
}
