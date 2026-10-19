// Sol, the companion (live, no AI provider): questions stream over SSE from
// POST /companion/ask/stream and the server's deterministic router answers.
// Memories and trackers are written by the server when Sol hears "remember
// that …" / "track …", and removed from the screen through sync.
//
// | Screen          | Action                                        | Test |
// |-----------------|-----------------------------------------------|------|
// | /capture (Sol)  | ask a question → streamed reply               | asks and gets a streamed reply |
// | /capture        | capability card on the welcome screen         | asks and gets a streamed reply |
// | /capture        | suggestion chip under a reply                 | asks and gets a streamed reply |
// | /capture        | "remember that …" → memory                    | memories: create and forget |
// | /capture        | memory block: tap a memory to forget it       | memories: create and forget |
// | /capture        | "track …" → tracker card                      | trackers: create and stop |
// | /capture        | tracker card: Stop tracking                   | trackers: create and stop |
// | /capture        | no-provider info card                         | a log through Sol shows the built-in-rules card |
// | /capture        | plain question: no-provider indication        | NOT PRESENT: a rules-engine reply carries no info card (only captures do) — reported |
// | Companion drawer (+ button) | same composer as the full chat    | covered by the full chat (same ThreadComposer and ask()) |
// | /capture/settings | "Clear thread"                              | capture-settings.cy.ts |

import { api, noRows, rows, sendMessage, signIn } from "./capture-support"
import type { LiveUser } from "./support"

interface Msg {
  id: string
  role: string
  text: string | null
  blocks: { t: string }[]
}

function openSol(user: LiveUser) {
  signIn(user)
  cy.visit("/capture")
  cy.findByRole("textbox", { name: "Capture message" }).should("exist")
}

describe("Sol (live, rules engine)", () => {
  it("asks and gets a streamed reply", () => {
    cy.newLiveUser("sol").then((user) => {
      cy.intercept("POST", "**/api/v1/companion/ask/stream").as("ask")
      openSol(user)

      // A capability card on the welcome screen asks for real.
      cy.findByRole("button", { name: /^Coach\./ }).click()
      cy.wait("@ask").then(({ response }) => {
        expect(response?.statusCode).to.eq(200)
        expect(response?.headers["content-type"]).to.match(/text\/event-stream/)
        const body = String(response?.body)
        expect(body).to.match(/event: message/)
        expect(body).to.match(/event: done/)
      })
      cy.findByText("Honest read, coach hat on:").should("exist")
      cy.findByText("Coach me").should("exist") // the question, as my message

      rows(
        "select role, text from companion_message where owner_id = $1 and deleted_at is null order by created_at",
        [user.id],
        2,
      ).then((ms) => {
        expect(ms.map((m) => m.role)).to.deep.eq(["me", "sol"])
        expect(ms[1].text).to.eq("Honest read, coach hat on:")
      })
      api<{ data: Msg[] }>(user, "/companion/messages", (b) =>
        b.data.some((m) => m.role === "sol"),
      )

      // A typed question, then a suggestion chip under the reply.
      sendMessage("Plan my day")
      cy.findByText(/Here's how I'd run today/).should("exist")
      cy.findAllByRole("button", { name: "How am I doing?" }).last().click()
      cy.findByText("Here's what stands out from your records:").should("exist")
      rows(
        "select 1 from companion_message where owner_id = $1 and role = 'sol' and deleted_at is null",
        [user.id],
        3,
      )
    })
  })

  it("memories: create and forget", () => {
    cy.newLiveUser("sol").then((user) => {
      openSol(user)
      sendMessage("remember that I train for a half marathon in March")
      cy.findByText(/Got it — I'll remember that/).should("exist")
      cy.findByRole("button", {
        name: "I train for a half marathon in March",
      }).should("exist")

      rows(
        "select id, text from memory where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then(([m]) => {
        expect(m.text).to.eq("I train for a half marathon in March")
        api<{ memories: { id: string }[] }>(user, "/companion/", (b) =>
          b.memories.some((x) => x.id === m.id),
        )

        // Tap it to forget: the delete reaches the server through sync.
        cy.findByRole("button", {
          name: "I train for a half marathon in March",
        }).click()
        cy.findByRole("button", {
          name: "I train for a half marathon in March",
        }).should("not.exist")
        noRows("select 1 from memory where id = $1 and deleted_at is null", [
          m.id,
        ])
        api<{ memories: { id: string }[] }>(
          user,
          "/companion/",
          (b) => !b.memories.some((x) => x.id === m.id),
        )
      })
    })
  })

  it("trackers: create and stop", () => {
    cy.newLiveUser("sol").then((user) => {
      openSol(user)
      sendMessage("Track spending under 1500 a day")
      cy.findByText(/Tracking daily spending for you/).should("exist")

      rows(
        "select id, metric, goal, direction from tracker where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then(([tr]) => {
        expect(tr.metric).to.eq("spend")
        expect(Number(tr.goal)).to.eq(1500)
        expect(tr.direction).to.eq("below")
        api<{ trackers: { id: string }[] }>(user, "/companion/", (b) =>
          b.trackers.some((x) => x.id === tr.id),
        )

        cy.findAllByRole("button", {
          name: "Stop tracking Daily spending",
        })
          .first()
          .click()
        cy.findAllByRole("button", {
          name: "Stop tracking Daily spending",
        }).should("not.exist")
        noRows("select 1 from tracker where id = $1 and deleted_at is null", [
          tr.id,
        ])
        api<{ trackers: { id: string }[] }>(
          user,
          "/companion/",
          (b) => !b.trackers.some((x) => x.id === tr.id),
        )
      })
    })
  })

  it("a log through Sol shows the built-in-rules card (no AI provider)", () => {
    cy.newLiveUser("sol").then((user) => {
      openSol(user)
      sendMessage("weighed 80.2")
      cy.findByText("Read by the built-in rules").should("exist")
      cy.findByText(/No AI model is set up for capture/).should("exist")
      cy.findByRole("button", { name: "AI settings" }).click()
      cy.location("pathname").should("eq", "/capture/settings")
      rows(
        "select c.engine from capture c join reply_item r on r.capture_id = c.id where c.owner_id = $1 and c.text = 'weighed 80.2' and r.body->>'tone' = 'fallback'",
        [user.id],
      ).then(([c]) => expect(c.engine).to.eq("rules"))
      rows(
        "select weight_kg from weigh_in where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then(([w]) => expect(Number(w.weight_kg)).to.eq(80.2))
    })
  })
})
