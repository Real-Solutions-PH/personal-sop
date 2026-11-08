import type { NextConfig } from "next"

// Static export: `next build` writes plain HTML, CSS, JS and media to `out/`,
// which Cloudflare Pages serves as-is. No server, no middleware, no API routes.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
}

export default nextConfig
