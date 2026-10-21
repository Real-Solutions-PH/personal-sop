// Habits (live): the focus timer and the Live bar.
//
// | Screen               | Action                                  | Test |
// |----------------------|-----------------------------------------|------|
// | /habits/[id] detail  | ◉ Start timer → timer screen            | runs a timer to a saved log |
// | /habits/[id]/timer   | Start timer                             | runs a timer to a saved log |
// | /habits/[id]/timer   | Pause / Resume                          | runs a timer to a saved log |
// | /habits/[id]/timer   | +5m (extend)                            | runs a timer to a saved log |
// | /habits/[id]/timer   | Minimise → Live bar → Return to timer   | runs a timer to a saved log |
// | /habits/[id]/timer   | Stop → Keep going                       | runs a timer to a saved log |
// | /habits/[id]/timer   | Stop → minutes → Save log (finish)      | runs a timer to a saved log |
// | /habits/[id]/timer   | Stop → Discard session                  | discards a timer |
// | /habits/[id]/timer   | "Log time manually instead"             | discards a timer |
// | /habits/[id]/timer   | stale-timer prompt (>2× target / 4 h)   | NOT COVERABLE ON WEB: needs hours of wall-clock time; the same sheet is covered via Stop |
import {
  apiUntil,
  businessDay,
  dbRows,
  none,
  pulled,
  signIn,
} from "./habits-helpers"
import type { LiveUser } from "./support"

const TODAY = businessDay()

const seedTimed = (user: LiveUser, name: string) =>
  cy.liveApi<{ id: string }>(user, "POST", "/habits/", {
    name,
    icon: "📖",
    type: "duration",
    target: 20,
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  })

const timerRow = (habitId: string, extra = "") =>
  dbRows(
    `select target_sec, paused_at, bonus_sec from habit_timer
      where habit_id = $1 and deleted_at is null ${extra}`,
    [habitId],
  )
const liveRow = (userId: string, extra = "") =>
  dbRows(
    `select kind, label, href, paused_at from live_session
      where owner_id = $1 and deleted_at is null ${extra}`,
    [userId],
  )

describe("habits timer (live)", () => {
  it("runs a timer: start, pause, resume, +5m, Live bar, finish → log", () => {
    cy.newLiveUser("habits").then((user) => {
      seedTimed(user, "Read").then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Read")
        cy.findByRole("button", { name: "◉ Start timer" }).click()
        cy.location("pathname").should("eq", `/habits/${h.id}/timer`)
        cy.findByRole("button", { name: "Start timer" }).click()
        cy.findByText("Focusing").should("exist")
        timerRow(h.id).then(([t]) => expect(t.paused_at).to.eq(null))
        liveRow(user.id, "and kind = 'timer'").then(([l]) =>
          expect(l.href).to.eq(`/habits/${h.id}/timer`),
        )
        apiUntil<{ timer?: unknown }>(user, "/habits/timer", (b) =>
          JSON.stringify(b).includes(h.id),
        )

        cy.findByRole("button", { name: "Pause" }).click()
        cy.findByText("Paused").should("exist")
        timerRow(h.id, "and paused_at is not null")
        liveRow(user.id, "and paused_at is not null")
        cy.findByRole("button", { name: "Resume" }).click()
        timerRow(h.id, "and paused_at is null")
        liveRow(user.id, "and paused_at is null")

        cy.findByRole("button", { name: "Add 5 minutes" }).click()
        timerRow(
          h.id,
          "and coalesce(target_sec, 0) + coalesce(bonus_sec, 0) = 1500",
        )

        // Minimise: the Live bar keeps the session and leads back.
        cy.findByRole("button", { name: "Minimise — keeps running" }).click()
        cy.visit("/today")
        cy.findByRole("button", { name: "Return to 📖 Read" }).click()
        cy.location("pathname").should("eq", `/habits/${h.id}/timer`)

        // Stop → Keep going leaves it running; Stop → Save log finishes it.
        cy.findByRole("button", { name: "Stop" }).click()
        cy.findByRole("button", { name: "Keep going" }).click()
        cy.findByText("Focusing").should("exist")
        cy.findByRole("button", { name: "Stop" }).click()
        cy.findByLabelText("Minutes to log").clear().type("7")
        cy.findByRole("button", { name: "Save log" }).click()
        cy.location("pathname").should("eq", `/habits/${h.id}`)
        dbRows(
          `select status, value, source from habit_log
            where habit_id = $1 and day = $2::date and deleted_at is null
              and value = 7 and source = 'timer'`,
          [h.id, TODAY],
        )
        none(
          "select 1 from habit_timer where habit_id = $1 and deleted_at is null",
          [h.id],
        )
        none(
          "select 1 from live_session where owner_id = $1 and deleted_at is null",
          [user.id],
        )
        cy.findByRole("button", { name: /Return to/ }).should("not.exist")
      })
    })
  })

  it("discards a timer: no log, no timer, no Live bar", () => {
    cy.newLiveUser("habits").then((user) => {
      seedTimed(user, "Practice").then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}/timer`)
        pulled("Practice")
        cy.findByText("Log time manually instead").click()
        cy.location("pathname").should("eq", `/habits/${h.id}`)
        cy.visit(`/habits/${h.id}/timer`)
        cy.findByRole("button", { name: "Start timer" }).click()
        timerRow(h.id)
        liveRow(user.id, "and kind = 'timer'")
        cy.findByRole("button", { name: "Stop" }).click()
        cy.findByRole("button", { name: "Discard session" }).click()
        none(
          "select 1 from habit_timer where habit_id = $1 and deleted_at is null",
          [h.id],
        )
        none(
          "select 1 from live_session where owner_id = $1 and deleted_at is null",
          [user.id],
        )
        none(
          "select 1 from habit_log where habit_id = $1 and deleted_at is null",
          [h.id],
        )
      })
    })
  })
})
