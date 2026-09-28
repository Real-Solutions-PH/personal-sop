import type { NextConfig } from "next"

// Baseline security headers applied to every route. The CSP is intentionally
// limited to the directives that do not gate resource loading
// (frame-ancestors, object-src, base-uri) so it cannot break Next.js, the
// Supabase browser client, or Sentry. Locking down script-src/style-src/
// connect-src for this app requires validating each integration against the
// running app and is tracked as a follow-up.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "geolocation=(), microphone=(self), camera=(self), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
]

const nextConfig: NextConfig = {
  // Standalone is for the Docker image; Vercel's build adapter packages the
  // app itself and fails on standalone output (missing next-server.js.nft.json).
  output: process.env.VERCEL ? undefined : "standalone",
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
