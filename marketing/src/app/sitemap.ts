import type { MetadataRoute } from "next"
import { SITE } from "@/config/site"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 }]
}
