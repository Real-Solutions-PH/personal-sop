// Capture (live, no AI provider): text captures on the Sol screen are read by
// the server's deterministic rules engine, and every card decision writes in
// the target module. Each step is proven in the UI, through the API and in
// Postgres (`capture`, `record_card`, `card_write_log`, `reply_item` and the
// target module's own row).
//
// | Screen            | Action                                         | Test |
// |-------------------|------------------------------------------------|------|
// | /capture (Sol)    | text capture → expense card                    | expense: confirm, undo, redo |
// | /capture          | card Confirm                                   | expense: confirm, undo, redo |
// | /capture          | card ↶ Undo                                    | expense: confirm, undo, redo; habit log |
// | /capture          | card ↷ Redo                                    | expense: confirm, undo, redo |
// | /capture          | text capture → task card (auto-saved)          | task: edit, discard |
// | /capture          | card Edit (sheet → Save)                       | task: edit, discard |
// | /capture          | card × (discard a proposed card)               | task: edit, discard |
// | /capture          | follow-up ask: typed answer + Send answer      | follow-up ask |
// | /capture          | follow-up ask: Skip for now                    | follow-up ask |
// | /capture          | follow-up ask: Discard                         | follow-up ask |
// | /capture          | text capture → habit check-in                  | habit log |
// | /capture          | text capture → weigh-in                        | weigh-in and journal |
// | /capture          | text capture → journal entry                   | weigh-in and journal |
// | /capture          | "Read by the built-in rules" info card         | expense: confirm, undo, redo |
// | /capture          | offline send → queued → flush when online      | capture-offline.cy.ts |
// | /capture          | Photo (Library) upload                         | capture-offline.cy.ts (photo) |
// | /capture          | Record voice                                   | NOT COVERABLE ON WEB: needs the microphone (expo-audio) and on-device speech recognition |
// | /capture          | Attach statement file                          | NOT COVERABLE: the sheet sends only `fileName` (no `fileUri`), so live mode fails locally — reported defect |
// | /capture/history  | list, open a capture                           | history |
// | /capture/history/[id] | capture detail                             | history |
//
// Every test signs in a fresh user with no AI provider, so the server never
// calls a model.

import {
  api,
  type CardRow,
  captureRow,
  cardIn,
  logged,
  noRows,
  revisit,
  rows,
  sendMessage,
  signIn,
} from "./capture-support"
import type { LiveUser } from "./support"

interface CaptureDetail {
  id: string
  status: string
  engine: string | null
  cards: { id: string; state: string; kind: string; refs: string[] }[]
  replies: { kind: string; body: { title?: string } }[]
}

function openSol(user: LiveUser) {
  signIn(user)
  cy.visit("/capture")
  cy.findByRole("textbox", { name: "Capture message" }).should("exist")
}

/** The capture's card, once the API agrees on its state. */
function apiCard(user: LiveUser, captureId: string, state: string) {
  return api<CaptureDetail>(user, `/capture/${captureId}`, (d) =>
    d.cards.some((c) => c.state === state),
  )
}

describe("capture (live, rules engine)", () => {
  it("expense: confirm, undo, redo — with the built-in-rules info card", () => {
    const text = "spent 250 on lunch"
    cy.newLiveUser("capture").then((user) => {
      openSol(user)
      sendMessage(text)

      // The rules engine proposes an expense and says no model read it.
      cy.findByText("Confirm?").should("exist")
      cy.findByText("Read by the built-in rules").should("exist")
      cy.findByText(/No AI model is set up for capture/).should("exist")
      cy.findByRole("button", { name: "AI settings" }).should("exist")

      captureRow(user, text, "done").then((cap) => {
        expect(cap.engine).to.eq("rules")
        rows(
          "select body->>'title' title from reply_item where capture_id = $1 and kind = 'info'",
          [cap.id],
        ).then(([r]) => expect(r.title).to.eq("Read by the built-in rules"))
        cardIn(user, cap.id, "proposed").then((card) => {
          expect(card.kind).to.eq("expense")
          noRows(
            "select 1 from fin_record where owner_id = $1 and deleted_at is null",
            [user.id],
          )

          // Confirm: the expense is written in finance.
          cy.findByRole("button", { name: "Confirm" }).click()
          cy.findByText("✓ Saved").should("exist")
          cardIn(user, cap.id, "saved").then((saved: CardRow) => {
            expect(saved.refs).to.have.length(1)
            const recordId = saved.refs[0]
            rows(
              "select amount_minor, deleted_at from fin_record where id = $1 and owner_id = $2 and deleted_at is null",
              [recordId, user.id],
            ).then(([r]) => expect(Number(r.amount_minor)).to.eq(25000))
            logged(card.id, "saved").then(([l]) =>
              expect(l.actor).to.eq("user"),
            )
            apiCard(user, cap.id, "saved")

            // Undo: the expense is removed again.
            cy.findByRole("button", { name: "↶ Undo" }).click()
            cy.findByText("Undone").should("exist")
            cardIn(user, cap.id, "undone")
            noRows(
              "select 1 from fin_record where id = $1 and deleted_at is null",
              [recordId],
            )
            logged(card.id, "undone")
            apiCard(user, cap.id, "undone")

            // Redo: it comes back.
            cy.findByRole("button", { name: "↷ Redo" }).click()
            cy.findByText("✓ Saved").should("exist")
            cardIn(user, cap.id, "saved").then((again) => {
              rows(
                "select 1 from fin_record where id = $1 and deleted_at is null",
                [again.refs[0]],
              )
            })
            logged(card.id, "redone")
            apiCard(user, cap.id, "saved")
          })
        })
      })
    })
  })

  it("task: edit an auto-saved card, discard a proposed one", () => {
    cy.newLiveUser("capture").then((user) => {
      openSol(user)
      sendMessage("buy eggs")
      cy.findByText("✓ Saved").should("exist")

      captureRow(user, "buy eggs", "done").then((cap) => {
        cardIn(user, cap.id, "saved").then((card) => {
          expect(card.kind).to.eq("task")
          const taskId = card.refs[0]
          rows("select title from task where id = $1 and owner_id = $2", [
            taskId,
            user.id,
          ]).then(([t]) => expect(t.title).to.eq("Eggs"))
          logged(card.id, "saved").then(([l]) => expect(l.actor).to.eq("ai"))

          // Edit: the sheet's change reaches the task.
          cy.findByRole("button", { name: "Edit" }).click()
          cy.findByRole("textbox", { name: "Task title" })
            .clear()
            .type("Brown eggs")
          cy.findByRole("button", { name: "Save" }).click()
          cy.findByText("✓ Edited").should("exist")
          cardIn(user, cap.id, "edited")
          rows("select 1 from task where id = $1 and title = $2", [
            taskId,
            "Brown eggs",
          ])
          logged(card.id, "edited")
          apiCard(user, cap.id, "edited")
          api<{ data: { id: string; title: string }[] }>(user, "/tasks/", (b) =>
            b.data.some((t) => t.id === taskId && t.title === "Brown eggs"),
          )
        })
      })

      // Discard: a proposed reminder is dropped before anything is written.
      const reminder = "remind me to call mom tomorrow"
      sendMessage(reminder)
      cy.findByText("Confirm?").should("exist")
      captureRow(user, reminder, "done").then((cap) => {
        cardIn(user, cap.id, "proposed").then((card) => {
          cy.findByRole("button", { name: "×" }).click()
          cy.findByText("Discarded").should("exist")
          cardIn(user, cap.id, "discarded")
          logged(card.id, "discarded")
          apiCard(user, cap.id, "discarded")
          noRows(
            "select 1 from task where owner_id = $1 and title ilike '%mom%'",
            [user.id],
          )
        })
      })
    })
  })

  it("follow-up ask: answer it, skip it, discard it", () => {
    cy.newLiveUser("capture").then((user) => {
      openSol(user)

      // Answer by typing.
      sendMessage("paid 1500")
      cy.findByText("Needs answer").should("exist")
      cy.findByText("What was ₱1,500 for?").should("exist")
      captureRow(user, "paid 1500", "needs_input").then((cap) => {
        cardIn(user, cap.id, "needs_input").then((card) => {
          cy.findByRole("textbox", { name: "Answer" }).type("groceries")
          cy.findByRole("button", { name: "Send answer" }).click()
          cy.findByText("What was ₱1,500 for?").should("not.exist")
          cy.findByText("Confirm?").should("exist")
          rows(
            "select payload from record_card where id = $1 and state = 'proposed'",
            [card.id],
          ).then(([r]) => {
            const p = r.payload as { category_id?: string }
            expect(p.category_id, "the answer set a category").to.be.a("string")
          })
          logged(card.id, "edited")
          api<CaptureDetail>(user, `/capture/${cap.id}`, (d) =>
            d.cards.every((c) => c.state !== "needs_input"),
          )
        })
      })

      // Skip for now.
      sendMessage("paid 900")
      cy.findByText("What was ₱900 for?").should("exist")
      captureRow(user, "paid 900", "needs_input").then((cap) => {
        cardIn(user, cap.id, "needs_input").then((card) => {
          // Skipping keeps the question open (as the prototype does) and
          // marks the card so History lists it as waiting.
          cy.findByRole("button", { name: "Skip for now" }).click()
          cy.findByText(
            "Skipped — waiting in History until you answer.",
          ).should("exist")
          rows(
            "select 1 from record_card where id = $1 and state = 'needs_input' and warn like 'Skipped%'",
            [card.id],
          )
        })
      })

      // Discard from the ask.
      sendMessage("paid 700")
      cy.findByText("What was ₱700 for?").should("exist")
      captureRow(user, "paid 700", "needs_input").then((cap) => {
        cardIn(user, cap.id, "needs_input").then((card) => {
          cy.findByText("What was ₱700 for?")
            .parent()
            .parent()
            .within(() => cy.findByRole("button", { name: "Discard" }).click())
          cardIn(user, cap.id, "discarded")
          logged(card.id, "discarded")
          apiCard(user, cap.id, "discarded")
        })
      })
    })
  })

  it("habit log: a check-in reaches habits, undo removes it", () => {
    cy.newLiveUser("capture").then((user) => {
      signIn(user)
      cy.liveApi<{ id: string }>(user, "POST", "/habits/", {
        name: "Meditate",
      }).then((habit) => {
        revisit("/capture")
        sendMessage("did my meditation")
        cy.findByText("✓ Saved").should("exist")
        captureRow(user, "did my meditation", "done").then((cap) => {
          cardIn(user, cap.id, "saved").then((card) => {
            expect(card.kind).to.eq("habitLog")
            rows(
              "select id from habit_log where habit_id = $1 and owner_id = $2 and deleted_at is null",
              [habit.id, user.id],
            )
            cy.findByRole("button", { name: "↶ Undo" }).click()
            cy.findByText("Undone").should("exist")
            cardIn(user, cap.id, "undone")
            noRows(
              "select 1 from habit_log where id = $1 and deleted_at is null",
              [card.refs[0]],
            )
            apiCard(user, cap.id, "undone")
          })
        })
      })
    })
  })

  it("weigh-in and journal: each lands in its module", () => {
    cy.newLiveUser("capture").then((user) => {
      openSol(user)
      sendMessage("weighed 78.4")
      cy.findAllByText("✓ Saved").should("have.length", 1)
      captureRow(user, "weighed 78.4", "done").then((cap) => {
        cardIn(user, cap.id, "saved").then((card) => {
          expect(card.kind).to.eq("weighIn")
          rows(
            "select weight_kg from weigh_in where id = $1 and owner_id = $2 and deleted_at is null",
            [card.refs[0], user.id],
          ).then(([w]) => expect(Number(w.weight_kg)).to.eq(78.4))
        })
      })

      const entry = "journal: long day but I showed up anyway"
      sendMessage(entry)
      cy.findAllByText("✓ Saved").should("have.length", 2)
      captureRow(user, entry, "done").then((cap) => {
        cardIn(user, cap.id, "saved").then((card) => {
          expect(card.kind).to.eq("journal")
          rows(
            "select body, capture_id from journal_entry where id = $1 and owner_id = $2 and deleted_at is null",
            [card.refs[0], user.id],
          ).then(([j]) => {
            expect(j.body).to.match(/long day but I showed up anyway/i)
            expect(j.capture_id).to.eq(cap.id)
          })
          api<{ data: { id: string }[] }>(user, "/journal/", (b) =>
            b.data.some((e) => e.id === card.refs[0]),
          )
        })
      })
    })
  })

  it("history: the capture list and a capture's detail come from the server", () => {
    cy.newLiveUser("capture").then((user) => {
      signIn(user)
      cy.liveApi<CaptureDetail>(user, "POST", "/capture/", {
        client_uuid: crypto.randomUUID(),
        source: "text",
        text: "buy rice",
      }).then((cap) => {
        expect(cap.cards[0].state).to.eq("saved")
        revisit("/capture/history")
        cy.findAllByText("buy rice").should("have.length.gte", 1)
        cy.visit(`/capture/history/${cap.id}`)
        cy.findAllByText("buy rice").should("have.length.gte", 1)
        cy.findByText("✓ Saved").should("exist")
      })
    })
  })
})
