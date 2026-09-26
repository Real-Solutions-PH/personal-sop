import path from "node:path"
import { defineConfig } from "cypress"
import dotenv from "dotenv"

// Cypress transpiles this config to CJS, where __dirname exists natively.
// import.meta must not be used here — it forces ESM loading of the CJS
// output and crashes with "exports is not defined in ES module scope".
dotenv.config({ path: path.join(__dirname, "../.env") })

// OS-level CYPRESS_* variables (CYPRESS_BASE_URL, CYPRESS_API_URL,
// CYPRESS_MAILPIT_HOST, …) still override everything set here.
export default defineConfig({
  e2e: {
    baseUrl: process.env.FRONTEND_HOST || "http://localhost:3000",
    testIsolation: true,
  },
  // CI runs the frontend as `next dev` in a container: routes compile on
  // demand (2-4s each on a shared GitHub runner) and dev evicts idle entries,
  // so a first navigation after login can legitimately take longer than the
  // 4s default before the URL commits. Locally everything is warm and fast;
  // this only buys headroom on slow runners.
  defaultCommandTimeout: 15000,
  env: {
    FIRST_SUPERUSER: process.env.FIRST_SUPERUSER,
    FIRST_SUPERUSER_PASSWORD: process.env.FIRST_SUPERUSER_PASSWORD,
    // Mailpit ships with the local Supabase stack (make supabase-up) —
    // GoTrue delivers auth emails there; web UI and API on port 54324.
    MAILPIT_HOST: process.env.MAILPIT_HOST || "http://127.0.0.1:54324",
    API_URL: process.env.API_URL || "http://localhost:8000",
  },
  retries: {
    runMode: 2,
    openMode: 0,
  },
  video: false,
  screenshotOnRunFailure: true,
})
