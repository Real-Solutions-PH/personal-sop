// E2E for the mobile app in live mode (Expo web build of the product UI,
// talking to the real API, Supabase GoTrue and Postgres).
//
// Every spec drives the real screens, then proves the result landed on the
// server twice: through the API (`cy.liveApi`) and straight from Postgres
// (`cy.task("sql")`). Run against a disposable local stack only:
//
//   CYPRESS_MOBILE_URL=http://localhost:8082 bunx cypress run \
//     --config-file cypress.mobile.config.ts
import path from "node:path"
import { defineConfig } from "cypress"
import dotenv from "dotenv"
import { Client } from "pg"

dotenv.config({ path: path.join(__dirname, "../.env") })

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321"

function assertLocal(url: string, what: string) {
  const host = new URL(url).hostname
  if (!["localhost", "127.0.0.1"].includes(host))
    throw new Error(`${what} must be a local test stack, got ${host}`)
}

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_MOBILE_URL || "http://localhost:8082",
    specPattern: "cypress/mobile/**/*.cy.ts",
    supportFile: "cypress/mobile/support.ts",
    viewportWidth: 414,
    viewportHeight: 896,
    defaultCommandTimeout: 20000,
    testIsolation: true,
    video: false,
    setupNodeEvents(on) {
      assertLocal(SUPABASE_URL, "SUPABASE_URL")
      assertLocal(
        `http://${process.env.POSTGRES_SERVER || "localhost"}`,
        "POSTGRES_SERVER",
      )
      on("task", {
        /** A confirmed GoTrue user (admin API), ready to sign in. */
        async createLiveUser({
          email,
          password,
        }: {
          email: string
          password: string
        }) {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email, password, email_confirm: true }),
          })
          if (!res.ok) throw new Error(`createLiveUser failed: ${res.status}`)
          const body = (await res.json()) as { id: string }
          return body.id
        },
        /** A password-grant access token for API assertions. */
        async liveToken({
          email,
          password,
        }: {
          email: string
          password: string
        }) {
          const res = await fetch(
            `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
            {
              method: "POST",
              headers: {
                apikey: process.env.SUPABASE_ANON_KEY ?? "",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ email, password }),
            },
          )
          if (!res.ok) throw new Error(`liveToken failed: ${res.status}`)
          return ((await res.json()) as { access_token: string }).access_token
        },
        /** Read-only SQL against the API's database (parameterised). */
        async sql({ text, values }: { text: string; values?: unknown[] }) {
          if (!/^\s*select\b/i.test(text))
            throw new Error("sql task is read-only")
          const client = new Client({
            host: process.env.POSTGRES_SERVER || "localhost",
            port: Number(process.env.POSTGRES_PORT || 5432),
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB,
          })
          await client.connect()
          try {
            return (await client.query(text, values)).rows
          } finally {
            await client.end()
          }
        },
        /** The newest Mailpit message to an address (sign-up / reset codes). */
        async latestMail(to: string) {
          const host = process.env.MAILPIT_HOST || "http://127.0.0.1:54324"
          const list = await fetch(
            `${host}/api/v1/search?query=to:${encodeURIComponent(to)}`,
          )
          const found = (await list.json()) as { messages?: { ID: string }[] }
          const id = found.messages?.[0]?.ID
          if (!id) return null
          const msg = await fetch(`${host}/api/v1/message/${id}`)
          return ((await msg.json()) as { Text: string }).Text
        },
      })
    },
  },
  env: {
    API_URL: process.env.CYPRESS_API_URL || "http://localhost:8765",
  },
})
