// "live" mode: the product UI (src/app/(sop)) backed by the API server, with
// Supabase sign-in and local-first sync. Prototype mode stays the default
// demo; "connected" is the original template shell.
export const liveMode = process.env.EXPO_PUBLIC_APP_MODE === "live"

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "")

export const API_PREFIX = "/api/v1"
