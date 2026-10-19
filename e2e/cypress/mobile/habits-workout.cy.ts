// Habits (live): a habit linked to workouts is ticked when a workout finishes.
//
// | Screen               | Action                                       | Test |
// |----------------------|----------------------------------------------|------|
// | /habits/new (form)   | Link to workouts switch                      | ticks the linked habit |
// | /habits/[id] detail  | "Auto-checks when a workout is logged" + done state after a workout | ticks the linked habit |
// | Today → Habits card  | linked habit shows done                      | ticks the linked habit |
import { businessDay, dbRows, signIn } from "./habits-helpers"

const TODAY = businessDay()

describe("habits ↔ fitness (live)", () => {
  it("ticks a habit linked to workouts when a workout finishes", () => {
    cy.newLiveUser("habits").then((user) => {
      signIn(user)
      cy.visit("/habits/new")
      cy.findByLabelText("Name").type("Move")
      cy.findByRole("switch", { name: "Link to workouts" }).click()
      cy.findByRole("button", { name: "Create habit" }).click()
      cy.location("pathname").should("match", /^\/habits\/[0-9a-f-]{36}$/)
      cy.findByText("Auto-checks when a workout is logged").should("exist")
      cy.location("pathname").then((p) => {
        const id = p.split("/")[2]
        dbRows("select 1 from habit where id = $1 and link_workout", [id])
        cy.findByRole("button", { name: "Mark done today" }).should("exist")

        // Fitness: start and finish a workout through the API.
        cy.liveApi<{ workout: { id: string } }>(
          user,
          "POST",
          "/fitness/workouts/start",
          { source: "empty" },
        ).then(({ workout }) => {
          cy.liveApi(user, "POST", `/fitness/workouts/${workout.id}/finish`, {
            unfinished: "remove",
          })
          dbRows(
            `select status, source from habit_log
              where habit_id = $1 and day = $2::date and deleted_at is null
                and status = 'done' and source = 'workout'`,
            [id, TODAY],
          )
        })

        // The app pulls the server's tick: the detail and Today both show it.
        cy.reload()
        cy.findByRole("button", { name: "✓ Done today — undo" }).should("exist")
        cy.findByText(/via workout/).should("exist")
        cy.visit("/today")
        cy.findByRole("button", { name: /Show completed habits/ }).click()
        // "Reopen" is the done state's label (no aria-checked on web).
        cy.findByRole("checkbox", { name: "Reopen Move" }).should("exist")
      })
    })
  })
})
