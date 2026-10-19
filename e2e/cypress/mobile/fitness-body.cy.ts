// Fitness · body weight and fitness settings (live).
//
// Inventory (screen → action → test):
// | Screen                        | Action                                        | Test |
// |-------------------------------|-----------------------------------------------|------|
// | Body (/fitness/body)          | First weigh-in (weight, body fat, note)       | B1   |
// | Body                          | Edit a weigh-in                               | B1   |
// | Body                          | Delete a weigh-in, then Undo                  | B1   |
// | Body                          | Weight trend: 7-day average + weekly rate = GET /fitness/body | B1 |
// | Body                          | Goal sheet: direction + goal weight           | B1   |
// | Body hub (/fitness?tab=body)  | "Weighed in today" reflects the server row    | B1   |
// | Settings (/fitness/settings)  | Units                                         | S1   |
// | Settings                      | Default rest                                  | S1   |
// | Settings                      | Weekly session target (More / Fewer)          | S1   |
// | Settings                      | Progression mode                              | S1   |
// | Settings                      | Weigh-in reminder time                        | S1   |
// | Settings                      | AI for meals source                           | S1   |
// | Settings                      | Library links (Exercises, Templates, Macro targets) | S1 |
// | Settings                      | Reset fitness demo data: hidden in live mode (fix in this branch) | S2 |
import { api, rows, signIn } from "./fitness.helpers"
import type { LiveUser } from "./support"

const SETTINGS =
  "select units, rest_sec, weekly_target, weigh_in_reminder, progression, ai_source, goal_direction, goal_weight from fitness_settings where owner_id = $1 and deleted_at is null"

function seedSettings(user: LiveUser) {
  cy.liveApi(user, "GET", "/fitness/overview")
}

describe("fitness · body & settings (live)", {
  defaultCommandTimeout: 60000,
}, () => {
  it("B1: weigh-ins — add, edit, delete + undo, trend, goal", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedSettings(user)
      signIn(user)
      cy.visit("/fitness/body")
      cy.findByText("First weigh-in sets your starting point", {
        timeout: 90000,
      }).should("exist")

      cy.findByRole("button", { name: "Weigh in" }).click()
      cy.findByRole("textbox", { name: "Weight (kg)" }).clear().type("80.4")
      cy.findByRole("textbox", { name: "Body fat % (optional)" }).type("18.5")
      cy.findByRole("textbox", { name: "Note (optional)" }).type("E2E morning")
      cy.findByRole("button", { name: "Log weigh-in" }).click()

      const ROW =
        "select id, weight_kg, body_fat_pct, note, deleted_at from weigh_in where owner_id = $1"
      rows(`${ROW} and note = 'E2E morning'`, [user.id]).then(([w]) => {
        expect(w).to.include({ weight_kg: 80.4, body_fat_pct: 18.5 })
        const wid = w.id as string

        // History for the trend: one weigh-in a day for the 12 days before.
        for (let d = 12; d >= 1; d--)
          cy.liveApi(user, "POST", "/fitness/weigh-ins", {
            weight_kg: 82 - (12 - d) * 0.1,
            measured_at: new Date(Date.now() - d * 864e5).toISOString(),
          })
        rows(`${ROW} and deleted_at is null`, [user.id], 13)
        cy.reload()
        cy.findAllByText("80.4", { timeout: 90000 }).should("exist")

        // Edit today's entry.
        // The entry row is the last "80.4" (after Latest / Lowest).
        cy.findAllByText("80.4").last().click()
        cy.findByText("Edit weigh-in").should("exist")
        cy.findByRole("textbox", { name: "Weight (kg)" }).clear().type("80.1")
        cy.findByRole("button", { name: "Save changes" }).click()
        rows(`${ROW} and id = $2 and weight_kg = 80.1`, [user.id, wid])

        // Trend: the screen's 7-day average and weekly rate are the server's.
        api<{
          weekly_rate: { kg: number; avg: number } | null
          latest: { weight_kg: number }
        }>(user, "/fitness/body", (b) => b.latest?.weight_kg === 80.1).then(
          (body) => {
            expect(body.weekly_rate, "server weekly rate").to.not.eq(null)
            const rate = body.weekly_rate!
            cy.contains(`${rate.avg.toFixed(1)} kg`).should("exist")
            cy.contains("kg/wk")
              .invoke("text")
              .should("contain", Math.abs(rate.kg).toFixed(2))
          },
        )

        // Delete, then Undo.
        cy.findAllByText("80.1").last().click()
        cy.findByRole("button", { name: "Delete weigh-in" }).click()
        rows(`${ROW} and id = $2 and deleted_at is not null`, [user.id, wid])
        cy.findByText("Undo").click()
        cy.findAllByText("80.1").should("exist")
        rows(`${ROW} and id = $2 and deleted_at is null`, [user.id, wid])

        // Goal: lose weight, towards a goal weight.
        cy.findByText("Goal").click()
        cy.findByText("Body goal").should("exist")
        cy.findByText("Lose").click()
        cy.findByRole("button", { name: "Lower goal weight" }).click()
        cy.findByRole("button", { name: "Save" }).click()
        rows(
          `${SETTINGS} and goal_direction = 'cut' and goal_weight is not null`,
          [user.id],
        ).then(([st]) =>
          api<{ goal_direction: string; goal_weight: number }>(
            user,
            "/fitness/body",
            (b) =>
              b.goal_direction === "cut" && b.goal_weight === st.goal_weight,
          ),
        )

        // The hub shows today's weigh-in from the server row.
        cy.visit("/fitness?tab=body")
        cy.findByText("Weighed in today").should("exist")
        cy.findByText("80.1 kg").should("exist")
      })
    })
  })

  it("S1: fitness settings rows reach fitness_settings", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedSettings(user)
      signIn(user)
      rows(SETTINGS, [user.id]).then(([st]) =>
        expect(st).to.include({
          units: "kg",
          rest_sec: 120,
          weekly_target: 4,
          progression: "double",
          ai_source: "builtin",
        }),
      )
      cy.visit("/fitness")
      cy.findByText("Push A", { timeout: 90000 }).should("exist")
      cy.findByRole("button", { name: "Fitness settings" }).click()
      cy.location("pathname").should("eq", "/fitness/settings")

      cy.findByText("lb").click()
      rows(`${SETTINGS} and units = 'lb'`, [user.id])
      cy.findByText("90s").click()
      rows(`${SETTINGS} and rest_sec = 90`, [user.id])
      const target = () => cy.findByRole("button", { name: "Fewer" }).next()
      cy.findByRole("button", { name: "More" }).click()
      target().should("have.text", "5")
      rows(`${SETTINGS} and weekly_target = 5`, [user.id])
      cy.findByRole("button", { name: "Fewer" }).click()
      target().should("have.text", "4")
      rows(`${SETTINGS} and weekly_target = 4`, [user.id])
      cy.findByRole("button", { name: "Fewer" }).click()
      target().should("have.text", "3")
      rows(`${SETTINGS} and weekly_target = 3`, [user.id])
      cy.findByText("Weight every session").click()
      rows(`${SETTINGS} and progression = 'linear'`, [user.id])
      cy.findByRole("textbox", { name: "Reminder time" }).clear().type("07:15")
      rows(`${SETTINGS} and weigh_in_reminder = '07:15'`, [user.id])
      cy.findByText("Claude connector").click()
      rows(`${SETTINGS} and ai_source = 'connector'`, [user.id])
      api<{
        units: string
        rest_sec: number
        weekly_target: number
        weigh_in_reminder: string
        progression: string
        ai_source: string
      }>(
        user,
        "/fitness/settings",
        (b) =>
          b.units === "lb" &&
          b.rest_sec === 90 &&
          b.weekly_target === 3 &&
          b.weigh_in_reminder === "07:15" &&
          b.progression === "linear" &&
          b.ai_source === "connector",
      )

      // The settings survive a reload (pulled back from the server).
      cy.reload()
      cy.findByRole("textbox", { name: "Reminder time" }).should(
        "have.value",
        "07:15",
      )
      cy.findByRole("button", { name: "Fewer" }).next().should("have.text", "3")

      // Library links.
      cy.findByText("Exercises").click()
      cy.location("pathname").should("eq", "/fitness/exercises")
      cy.go("back")
      cy.findByText("Templates").click()
      cy.location("pathname").should("eq", "/fitness/templates")
      cy.go("back")
      cy.findByText("Macro targets").click()
      cy.location("pathname").should("eq", "/fitness/nutrition/targets")
    })
  })

  it("S2: no demo reset in live mode (a live account's data is never replaced by samples)", () => {
    // Before the fix the row was live: it reloaded the prototype's samples on
    // the device and pushed its default settings (rest_sec 120 measured on the
    // server) while the server's own weigh-ins stayed — screen and server
    // disagreed. Me hides its "Reset demo data" in live mode; so does this.
    cy.newLiveUser("fitness").then((user) => {
      seedSettings(user)
      signIn(user)
      cy.visit("/fitness/settings")
      cy.findByText("Push A · Pull A · Legs A", { timeout: 90000 }).should(
        "exist",
      )
      cy.findByText("Reset fitness demo data").should("not.exist")
    })
  })
})
