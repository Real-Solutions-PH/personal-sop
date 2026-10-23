/**
 * Cloudflare sits in front of everything: the API host is served by a
 * Cloudflare Tunnel (scripts/cloudflare.ts), so no AWS resource listens on
 * the internet. Cloudflare sets `CF-Connecting-IP` to the visitor's address
 * on every request it forwards, and only the tunnel can reach the API and
 * GoTrue's proxy, so the header can be trusted.
 */
export const CLIENT_IP_HEADER = "CF-Connecting-IP"

/**
 * Rate limits, now that there is no AWS WAF:
 * - in the API, per user AND per visitor address (Redis token buckets,
 *   backend/app/shared/rate_limit.py), requests per minute;
 * - at Cloudflare, one zone rate-limiting rule (the Free plan allows one),
 *   per visitor address over 10 seconds, on the AI and auth paths;
 * - GoTrue's own per-address limits for sign-in (prod-stack.ts).
 */
export const RATE_LIMITS = {
  aiPerMinute: 20,
  accountPerMinute: 10,
  cloudflare: { requestsPer10Seconds: 50, blockSeconds: 10 },
} as const

/** Paths the Cloudflare rule counts: sign-in and the model-backed routes. */
export const CLOUDFLARE_LIMITED_PATHS = [
  "/auth/v1/",
  "/api/v1/ai/",
  "/api/v1/companion/",
  "/api/v1/capture/",
  "/api/v1/ocr/",
  "/api/v1/fitness/meals/estimate",
] as const
