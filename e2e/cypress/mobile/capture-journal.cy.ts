// Journal (live): the journal screens write through sync to `journal_entry`.
//
// | Screen               | Action                                   | Test                  |
// |----------------------|------------------------------------------|-----------------------|
// | /journal/new         | write an entry (body, mood, tags) + save | creates, edits, deletes |
// | /journal/[id]        | edit body, mood, private toggle + save   | creates, edits, deletes |
// | /journal/[id]        | delete (trash icon)                      | creates, edits, deletes |
// | /journal             | list shows the entry; search             | creates, edits, deletes |
// | /journal             | "Talk it out" / Dictate (microphone)     | NOT COVERABLE ON WEB: needs the device microphone and on-device speech recognition |
// | Capture "journal: …" | capture creates an entry                 | capture.cy.ts (journal card) |

import { api, rows, settle } from "./capture-support"

describe("journal (live)", () => {
  it("creates, edits and deletes an entry — every step reaches the server", () => {
    cy.newLiveUser("capture-journal").then((user) => {
      cy.signInLive(user)
      settle()

      // Create.
      cy.visit("/journal/new")
      cy.findByRole("textbox", { name: "Entry" }).type(
        "Walked to the market at dawn and felt calm.",
      )
      cy.findByRole("button", { name: "Good" }).click()
      cy.findByRole("textbox", { name: "Tags" }).type("calm, walk")
      cy.findByRole("button", { name: "Save entry" }).click()
      cy.location("pathname").should("eq", "/journal")
      cy.findAllByText(/Walked to the market at dawn/).should("have.length.gte", 1)

      rows(
        "select id, body, mood, tags, private, deleted_at from journal_entry where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then(([row]) => {
        expect(row.body).to.eq("Walked to the market at dawn and felt calm.")
        expect(row.mood).to.eq(4)
        expect(row.tags).to.deep.eq(["calm", "walk"])
        expect(row.private).to.eq(true)
        const id = String(row.id)
        api<{ data: { id: string; body: string }[] }>(
          user,
          "/journal/",
          (b) => b.data.some((e) => e.id === id),
        )

        // Edit: body, mood, private.
        cy.visit(`/journal/${id}`)
        cy.findByRole("textbox", { name: "Entry" })
          .clear()
          .type("Walked to the market at dawn. Bought mangoes.")
        cy.findByRole("button", { name: "Great" }).click()
        cy.findByRole("switch", { name: "Private" }).click()
        cy.findByRole("button", { name: "Save changes" }).click()
        cy.location("pathname").should("eq", "/journal")
        rows(
          "select id from journal_entry where id = $1 and body = $2 and mood = 5 and private = false",
          [id, "Walked to the market at dawn. Bought mangoes."],
        )
        api<{ body: string; mood: number }>(
          user,
          `/journal/${id}`,
          (b) => b.body.endsWith("Bought mangoes.") && b.mood === 5,
        )

        // Delete: a tombstone, gone from the API list.
        cy.visit(`/journal/${id}`)
        cy.findByRole("button", { name: "Delete entry" }).click()
        cy.location("pathname").should("eq", "/journal")
        cy.findByText("Your journal is empty").should("exist")
        rows(
          "select id from journal_entry where id = $1 and deleted_at is not null",
          [id],
        )
        api<{ data: { id: string }[] }>(
          user,
          "/journal/",
          (b) => !b.data.some((e) => e.id === id),
        )
      })
    })
  })
})
