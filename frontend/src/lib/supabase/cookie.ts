// One explicit auth-cookie name for ALL Supabase clients (browser, server,
// middleware). Without it @supabase/ssr derives the name from the URL's
// host ("sb-127-..." vs "sb-host-...") — and the browser and the
// containerized server legitimately use DIFFERENT URLs for the same stack
// (127.0.0.1 vs host.docker.internal), so the middleware would never find
// the session the browser wrote. Bit us on CI's containerized E2E run.
export const AUTH_COOKIE_OPTIONS = { name: "sb-app-auth" } as const
