/**
 * Cloudflare sits in front of the ALB (proxied, SSL Full strict). The ALB
 * accepts HTTPS only from Cloudflare's published edge ranges, so the
 * `CF-Connecting-IP` header it forwards can be trusted as the client's
 * address (WAF rate limits and GoTrue's per-IP limits key on it).
 *
 * Source: https://www.cloudflare.com/ips-v4 (also /client/v4/ips, etag
 * 38f79d050aa027e3be3865e495dcc9bc), read 2026-10-23. IPv4 only: the ALB is
 * IPv4, so Cloudflare reaches it over IPv4. `scripts/cloudflare-dns.ts`
 * warns when the published list no longer matches this one.
 */
export const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const

/** Header Cloudflare sets to the visitor's IP on every proxied request. */
export const CLIENT_IP_HEADER = "CF-Connecting-IP"
