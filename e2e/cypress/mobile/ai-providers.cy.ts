// AI providers and AI settings (live).
//
// Bring-your-own provider credentials and per-purpose model assignments have
// no screen in the mobile app (nor in the web frontend) on this branch: the
// /ai/* endpoints are REST-only. They are exercised through the API here,
// with the end-to-end effect proven in the app: once a capture model is
// assigned to an unreachable provider, a capture on the Sol screen falls back
// to the built-in rules and says the AI didn't answer.
//
// | Screen / surface          | Action                                     | Test |
// |---------------------------|--------------------------------------------|------|
// | (no screen) /ai/providers | add a credential (Custom, fake key)        | credential lifecycle |
// | (no screen)               | read it back: only key_last4, never the key | credential lifecycle |
// | (no screen)               | stored key is ciphertext (SQL)             | credential lifecycle |
// | (no screen)               | verify fails cleanly (unreachable)         | credential lifecycle |
// | (no screen)               | model assignment per purpose (5 purposes)  | credential lifecycle |
// | (no screen)               | vision refused for a model without images  | credential lifecycle |
// | /capture (Sol)            | capture with an unreachable model assigned | credential lifecycle |
// | (no screen)               | remove an assignment, delete the credential | credential lifecycle |
// | /capture/settings         | AI on switch (kill switch) + its effect    | AI settings rows |
// | /capture/settings         | monthly spend cap chips                    | AI settings rows |
// | /capture/settings         | auto/confirm tier per entry type + effect  | AI settings rows |
// | /capture/settings         | "Confirm expenses above" threshold chips   | AI settings rows |
// | /capture/settings         | Send photos, Journal in Q&A switches       | AI settings rows |
// | /capture/settings         | finance detail, language, transcription    | AI settings rows |
// | /capture/settings         | Clear thread                               | AI settings rows |
// | /capture/settings         | Model list (OpenRouter presets)            | NOT COVERABLE END TO END: device-only by design (the ai_settings mapper keeps `model` on the device; no column) — the server uses the per-purpose assignments above, so this row changes nothing the server does — reported |
// | /capture/settings         | AI spend meter                             | AI settings rows (shows ₱0 · 0 calls with no provider) |
// | /capture/connector        | Claude connector                           | NOT COVERABLE: the screen says "coming soon"; no server endpoint |

import {
  api,
  captureRow,
  cardIn,
  noRows,
  revisit,
  rows,
  sendMessage,
  signIn,
} from "./capture-support"
import type { LiveUser } from "./support"

// Obviously fake, and aimed at a port nothing listens on (discard, 9).
const FAKE_KEY = "sk-e2e-FAKE-not-a-real-key-7Q4z"
const DEAD_URL = "http://127.0.0.1:9/v1"
const PURPOSES = ["chat", "capture", "vision", "transcription", "advisor"]

interface Credential {
  id: string
  provider: string
  base_url: string
  key_last4: string
  verified_at: string | null
  last_error_code: string | null
}

/** A password-grant token, for the one request that must not fail on 4xx. */
function token(user: LiveUser) {
  return cy.task<string>(
    "liveToken",
    { email: user.email, password: user.password },
    { log: false },
  )
}

function expectNoKey(body: unknown) {
  const json = JSON.stringify(body)
  expect(json, "response never carries the key").not.to.contain(FAKE_KEY)
  expect(json, "nor any long piece of it").not.to.contain("not-a-real-key")
  expect(json).not.to.match(/api_key|ciphertext/)
}

describe("AI providers and AI settings (live)", () => {
  it("credential lifecycle: add, read back, verify, assign, use, delete", () => {
    cy.newLiveUser("ai-providers").then((user) => {
      signIn(user)

      cy.liveApi<Credential>(user, "POST", "/ai/providers", {
        provider: "custom",
        label: "E2E fake",
        base_url: DEAD_URL,
        api_key: FAKE_KEY,
      }).then((cred) => {
        expect(cred.key_last4).to.eq("7Q4z")
        expect(cred.base_url).to.eq(DEAD_URL)
        expect(cred.verified_at).to.eq(null)
        expectNoKey(cred)

        cy.liveApi(user, "GET", "/ai/providers").then(expectNoKey)
        cy.liveApi(user, "GET", `/ai/providers/${cred.id}`).then(expectNoKey)

        // Postgres holds ciphertext: not the key, not containing it.
        rows(
          `select key_last4,
                  length(key_ciphertext) as len,
                  position(convert_to($2, 'UTF8') in key_ciphertext) as at,
                  position(convert_to('not-a-real-key', 'UTF8') in key_ciphertext) as part
             from ai_provider_credential where id = $1 and owner_id = $3`,
          [cred.id, FAKE_KEY, user.id],
        ).then(([r]) => {
          expect(r.key_last4).to.eq("7Q4z")
          expect(Number(r.len)).to.be.greaterThan(FAKE_KEY.length)
          expect(Number(r.at), "plaintext key not stored").to.eq(0)
          expect(Number(r.part), "no plaintext fragment stored").to.eq(0)
        })

        // Verify fails cleanly: a stable code, no exception text, no key.
        cy.liveApi<{ ok: boolean; code: string; credential: Credential }>(
          user,
          "POST",
          `/ai/providers/${cred.id}/verify`,
        ).then((v) => {
          // A refused connection is "unreachable" (provider_http.py); on this
          // stack the API's own egress answers for dead ports with an HTTP
          // error, which the server classifies "bad_response". Both are a
          // clean failure: a stable code, ok=false, nothing else.
          expect(v.ok).to.eq(false)
          expect(v.code).to.be.oneOf(["unreachable", "bad_response"])
          expect(v.credential.last_error_code).to.eq(v.code)
          expect(v.credential.verified_at).to.eq(null)
          expectNoKey(v)
        })
        rows(
          "select 1 from ai_provider_credential where id = $1 and last_error_code in ('unreachable', 'bad_response') and verified_at is null",
          [cred.id],
        )

        // Vision needs a model that reads images: unclaimed, it is refused.
        token(user).then((t) =>
          cy
            .request({
              method: "PUT",
              url: `${Cypress.env("API_URL")}/api/v1/ai/assignments/vision`,
              headers: { Authorization: `Bearer ${t}` },
              body: { credential_id: cred.id, model: "fake-vision-model" },
              failOnStatusCode: false,
            })
            .its("status")
            .should("eq", 422),
        )

        // A model per purpose.
        for (const purpose of PURPOSES)
          cy.liveApi(user, "PUT", `/ai/assignments/${purpose}`, {
            credential_id: cred.id,
            model: `fake-${purpose}-model`,
            supports_vision: purpose === "vision",
          })
        rows(
          "select purpose, model, credential_id from ai_model_assignment where owner_id = $1 order by purpose",
          [user.id],
          PURPOSES.length,
        ).then((as) => {
          expect(as.map((a) => a.purpose)).to.deep.eq([...PURPOSES].sort())
          for (const a of as) {
            expect(a.model).to.eq(`fake-${a.purpose}-model`)
            expect(a.credential_id).to.eq(cred.id)
          }
        })
        api<{ data: { purpose: string }[] }>(
          user,
          "/ai/assignments",
          (b) => b.data.length === PURPOSES.length,
        )

        // The app now tries that model; it can't answer, so the rules do.
        revisit("/capture")
        sendMessage("buy eggs")
        cy.findByText(
          "The AI didn't answer — the built-in rules read this",
        ).should("exist")
        captureRow(user, "buy eggs", "done").then((cap) => {
          expect(cap.engine).to.eq("rules")
          cardIn(user, cap.id, "saved").then((card) => {
            rows("select title from task where id = $1", [card.refs[0]]).then(
              ([t]) => expect(t.title).to.eq("Eggs"),
            )
          })
        })
        rows(
          "select model from ai_usage where owner_id = $1 and purpose = 'capture' and ok = false",
          [user.id],
        )

        // Remove one assignment, then the credential.
        cy.liveApi(user, "DELETE", "/ai/assignments/vision")
        noRows(
          "select 1 from ai_model_assignment where owner_id = $1 and purpose = 'vision'",
          [user.id],
        )
        cy.liveApi(user, "DELETE", `/ai/providers/${cred.id}`)
        noRows(
          "select 1 from ai_provider_credential where id = $1 and deleted_at is null",
          [cred.id],
        )
        api<{ data: Credential[] }>(user, "/ai/providers", (b) =>
          b.data.every((c) => c.id !== cred.id),
        )
        api<{ data: { credential_id: string }[] }>(
          user,
          "/ai/assignments",
          (b) => b.data.every((a) => a.credential_id !== cred.id),
        )
      })
    })
  })

  it("AI settings rows: AI on, spend cap, tiers, threshold, privacy, language, clear thread", () => {
    cy.newLiveUser("ai-providers").then((user) => {
      signIn(user)
      cy.visit("/capture/settings")
      cy.findByText("AI is on").should("exist")
      cy.findByText("AI spend this month").should("exist")
      const setting = (where: string) =>
        rows(
          `select * from ai_settings where owner_id = $1 and deleted_at is null and ${where}`,
          [user.id],
        )

      // Spend cap.
      cy.findByRole("button", { name: "₱1,000" }).click()
      setting("spend_cap_minor = 100000")

      // Tier: tasks need confirming.
      cy.findByText("Tasks")
        .parent()
        .parent()
        .within(() => cy.findByRole("tab", { name: "Confirm" }).click())
      setting("rules->>'task' = 'confirm'")

      // Money threshold.
      cy.findByRole("button", { name: "₱2,000" }).click()
      setting("money_threshold_minor = 200000")

      // Privacy switches, finance detail, language, transcription.
      cy.findByRole("switch", { name: "Send photos" }).click()
      cy.findByRole("switch", { name: "Journal in Q&A" }).click()
      cy.findByRole("tab", { name: "Individual transactions" }).click()
      cy.findByRole("tab", { name: "English" }).click()
      cy.findByRole("tab", { name: "On-device preview" }).click()
      setting(
        "send_photos = false and journal_in_qa = false and finance_scope = 'records' and language = 'en' and transcription = 'browser'",
      )
      api<{ spend_cap_minor: number; rules: Record<string, string> }>(
        user,
        "/capture/settings",
        (s) => s.spend_cap_minor === 100000 && s.rules.task === "confirm",
      )

      // The tier takes effect: a task now waits for Confirm.
      revisit("/capture")
      sendMessage("buy milk")
      cy.findByText("Confirm?").should("exist")
      captureRow(user, "buy milk", "done").then((cap) =>
        cardIn(user, cap.id, "proposed"),
      )

      // Kill switch: AI off refuses captures, keeping the input.
      revisit("/capture/settings")
      cy.findByRole("switch", { name: "AI on" }).click()
      cy.findByText("AI is off").should("exist")
      setting("ai_enabled = false")
      revisit("/capture")
      sendMessage("buy bread")
      captureRow(user, "buy bread", "failed").then((cap) => {
        expect(cap.engine).to.eq(null)
        noRows("select 1 from record_card where capture_id = $1", [cap.id])
      })
      cy.findByText("Quick add").should("exist")

      // Back on.
      revisit("/capture/settings")
      cy.findByRole("switch", { name: "AI on" }).click()
      cy.findByText("AI is on").should("exist")
      setting("ai_enabled = true")

      // Clear thread: captures leave the thread, the task stays.
      cy.findByText("Clear thread").click()
      noRows(
        "select 1 from capture where owner_id = $1 and deleted_at is null",
        [user.id],
      )
      rows(
        "select 1 from capture where owner_id = $1 and deleted_at is not null",
        [user.id],
        2,
      )
      api<{ data: unknown[] }>(user, "/capture/", (b) => b.data.length === 0)

      // The spend meter is the server's: with no provider, no paid calls.
      // (Last, so a wrong meter doesn't hide the rows above.)
      cy.liveApi<{ spend_minor: number; calls: number }>(
        user,
        "GET",
        "/capture/settings",
      ).then((st) => {
        expect(st.spend_minor).to.eq(0)
        expect(st.calls).to.eq(0)
      })
      revisit("/capture/settings")
      cy.findByText(/^0 calls/).should("exist")
      cy.findByText("₱0").should("exist")
    })
  })
})
