// Habits (live): routines — list, form, detail, steps, player and summary.
//
// | Screen                        | Action                                    | Test |
// |-------------------------------|-------------------------------------------|------|
// | /habits/routines              | New routine (+)                           | builds a routine |
// | /habits/routines/new (form)   | name, icon, schedule, reminder, Create & add steps | builds a routine |
// | /habits/routines/[id]         | Add steps picker: pick habits, Add N steps | builds a routine |
// | /habits/routines/[id]         | picker: New habit "<query>" → added as a step | builds a routine (FAILS after a removal: deleted_on_server — see the DEFECT note) |
// | /habits/routines/[id]         | More / Less time for a step               | builds a routine |
// | /habits/routines/[id]         | Remove step                               | builds a routine |
// | /habits/routines/[id]         | Reorder step (drag handle)                | NOT COVERABLE ON WEB: PanResponder drag / screen-reader actions only; step order is still proven through the picker order |
// | /habits/routines/[id]/edit    | rename, Save changes                      | builds a routine |
// | /habits/routines/[id]         | More actions → Archive                    | archives, restores, deletes |
// | /habits/routines (Archived)   | Restore                                   | archives, restores, deletes |
// | /habits/manage/archived       | routine Restore / Delete                  | archives, restores, deletes |
// | /habits/routines/[id]         | More actions → Delete                     | archives, restores, deletes |
// | /habits/routines/[id]         | Share routine                             | NOT COVERABLE ON WEB: opens the share composer whose output is a native share sheet |
// | /habits/routines/[id]/play    | Start, +1 min, Pause/Resume, Done, Skip, Back, Continue (already logged) | plays a routine |
// | /habits/routines/[id]/summary | steps, Done                               | plays a routine |
// | /habits/routines/[id]/play    | Leave routine (exit)                      | leaves a routine (fails against a build without the habits.run.exit mapper fix) |
// | /habits/routines/[id]         | Start routine / Resume · step n           | leaves a routine |
// | Today → Habits card           | routine Start / Resume                    | leaves a routine |
import {
  apiUntil,
  businessDay,
  dbRows,
  EVERY_DAY,
  none,
  pulled,
  type Row,
  signIn,
} from "./habits-helpers"
import type { LiveUser } from "./support"

const TODAY = businessDay()

const seedHabit = (user: LiveUser, name: string, icon: string) =>
  cy.liveApi<Row>(user, "POST", "/habits/", {
    name,
    icon,
    type: "check",
    schedule: EVERY_DAY,
  })

/** The routine's live steps as "habit:minutes", in position order. */
const steps = (routineId: string, expected: string) =>
  dbRows(
    `select string_agg(habit_id::text || ':' || minutes, ',' order by position) as s
       from routine_step where routine_id = $1 and deleted_at is null
     having coalesce(string_agg(habit_id::text || ':' || minutes, ',' order by position), '') = $2`,
    [routineId, expected],
  )

describe("habits routines (live)", () => {
  // DEFECT (reported, not in this write set): after "Remove Stretch" the
  // new-habit step takes position 1, whose derived id (routine + position)
  // is Stretch's tombstone; the server answers `conflict deleted_on_server`
  // and the step never lands (same revive-on-upsert gap as the re-pause).
  it("builds a routine: form, add steps, minutes, remove, new-habit step, edit", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, "Water", "💧").then((w) =>
        seedHabit(user, "Stretch", "🧘").then((s) => {
          signIn(user)
          cy.visit("/habits/manage")
          pulled("Stretch")
          cy.visit("/habits/routines")
          cy.findByText("Stack habits into one guided flow").should("exist")
          cy.findByRole("button", { name: "New routine" }).click()
          cy.findByRole("textbox", { name: "Name" }).type("Morning")
          cy.findByRole("button", { name: "Choose 🌅" }).click()
          cy.findByRole("button", { name: "Create & add steps" }).click()
          cy.location("pathname").should(
            "match",
            /^\/habits\/routines\/[0-9a-f-]{36}$/,
          )
          cy.location("pathname").then((p) => {
            const id = p.split("/")[3]
            dbRows(
              `select name, icon, schedule, status from routine
                where id = $1 and owner_id = $2 and status = 'active'`,
              [id, user.id],
            ).then(([r]) => {
              expect(r.name).to.eq("Morning")
              expect(r.schedule).to.deep.eq([
                { days: [0, 1, 2, 3, 4, 5, 6], time: "06:00" },
              ])
            })

            // The picker opens on create: pick two habits.
            cy.findByRole("checkbox", { name: "Water" }).click()
            cy.findByRole("checkbox", { name: "Stretch" }).click()
            cy.findByRole("button", { name: "Add 2 steps" }).click()
            steps(id, `${w.id}:5,${s.id}:5`)

            cy.findByRole("button", { name: "More time for Water" }).click()
            steps(id, `${w.id}:6,${s.id}:5`)
            cy.findByRole("button", { name: "Less time for Stretch" }).click()
            steps(id, `${w.id}:6,${s.id}:4`)

            cy.findByRole("button", { name: "Remove Stretch" }).click()
            steps(id, `${w.id}:6`)
            apiUntil<{ steps: { habit_id: string }[] }>(
              user,
              `/habits/routines/${id}`,
              (b) =>
                JSON.stringify(b).includes(w.id) &&
                !JSON.stringify(b).includes(s.id),
            )

            // A new habit created from the picker joins as the next step.
            cy.findByText("+ Add step").click()
            cy.findByLabelText("Search habits").type("Journal")
            cy.findByText("New habit “Journal”").click()
            cy.findByRole("textbox", { name: "Name" }).should(
              "have.value",
              "Journal",
            )
            cy.findByRole("button", { name: "Create habit" }).click()
            cy.location("pathname").should("eq", `/habits/routines/${id}`)
            dbRows(
              `select h.id from habit h join routine_step st on st.habit_id = h.id
                where h.owner_id = $1 and h.name = 'Journal' and st.routine_id = $2
                  and st.position > 0 and st.deleted_at is null`,
              [user.id, id],
            )

            // Edit: rename.
            cy.findByRole("button", { name: "Edit routine" }).click()
            cy.findByRole("textbox", { name: "Name" })
              .clear()
              .type("Morning flow")
            cy.findByRole("button", { name: "Save changes" }).click()
            dbRows(
              "select 1 from routine where id = $1 and name = 'Morning flow'",
              [id],
            )
          })
        }),
      )
    })
  })

  it("archives, restores and deletes routines", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, "Plank", "🏋️").then((h) =>
        cy
          .liveApi<Row>(user, "POST", "/habits/routines", {
            name: "Evening",
            icon: "🌙",
            schedule: EVERY_DAY,
            steps: [{ habit_id: h.id, minutes: 3 }],
          })
          .then((r) => {
            signIn(user)
            cy.visit(`/habits/routines/${r.id}`)
            pulled("Evening")
            cy.findByRole("button", { name: "More actions" }).click()
            cy.findByRole("button", { name: "Archive" }).click()
            cy.location("pathname").should("eq", "/habits/routines")
            dbRows(
              "select 1 from routine where id = $1 and status = 'archived'",
              [r.id],
            )

            cy.findByText(/Archived · 1/).click()
            pulled(/Evening/)
            cy.findByText("Restore").click()
            dbRows(
              "select 1 from routine where id = $1 and status = 'active'",
              [r.id],
            )
            apiUntil<{ data: { routine: Row }[] }>(
              user,
              "/habits/routines",
              (b) => b.data.some((x) => x.routine.id === r.id),
            )

            // Archive again, then restore and delete from Habits → Archived.
            cy.visit(`/habits/routines/${r.id}`)
            cy.findByRole("button", { name: "More actions" }).click()
            cy.findByRole("button", { name: "Archive" }).click()
            dbRows(
              "select 1 from routine where id = $1 and status = 'archived'",
              [r.id],
            )
            cy.visit("/habits/manage/archived")
            pulled(/Evening/)
            cy.findByRole("button", { name: "Restore" }).click()
            dbRows(
              "select 1 from routine where id = $1 and status = 'active'",
              [r.id],
            )

            // Delete from the detail's More sheet.
            cy.visit(`/habits/routines/${r.id}`)
            cy.findByRole("button", { name: "More actions" }).click()
            cy.findByRole("button", { name: "Delete" }).click()
            cy.location("pathname").should("eq", "/habits/routines")
            dbRows(
              "select 1 from routine where id = $1 and deleted_at is not null",
              [r.id],
            )
            // Its habit and the habit's row stay.
            dbRows("select 1 from habit where id = $1 and deleted_at is null", [
              h.id,
            ])
          }),
      )
    })
  })

  it("plays a routine: start, +1 min, pause, done, skip, back, continue, summary", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, "Water", "💧").then((a) =>
        seedHabit(user, "Stretch", "🧘").then((b) =>
          seedHabit(user, "Vitamins", "💊").then((c) =>
            cy
              .liveApi<Row>(user, "POST", "/habits/routines", {
                name: "Morning",
                icon: "🌅",
                schedule: EVERY_DAY,
                steps: [
                  { habit_id: a.id, minutes: 2 },
                  { habit_id: b.id, minutes: 3 },
                  { habit_id: c.id, minutes: 1 },
                ],
              })
              .then((r) => {
                // Vitamins is already logged today: its step offers Continue.
                cy.liveApi(user, "POST", `/habits/${c.id}/check`, {})
                signIn(user)
                cy.visit(`/habits/routines/${r.id}`)
                pulled("Morning")
                pulled(/Vitamins/)
                cy.findByRole("button", { name: /Start routine/ }).click()
                cy.location("pathname").should(
                  "eq",
                  `/habits/routines/${r.id}/play`,
                )
                cy.findByText("1/3").should("exist")
                const run = () =>
                  dbRows(
                    `select id, current, state, step_bonus_sec, paused_at from routine_run
                      where routine_id = $1 and day = $2::date and deleted_at is null`,
                    [r.id, TODAY],
                  )
                run().then(([x]) => expect(x.state).to.eq("in_progress"))
                dbRows(
                  `select 1 from live_session where owner_id = $1 and kind = 'routine'
                     and deleted_at is null`,
                  [user.id],
                )

                cy.findByRole("button", { name: "+1 min" }).click()
                dbRows(
                  "select 1 from routine_run where routine_id = $1 and step_bonus_sec = 60",
                  [r.id],
                )
                cy.findByRole("button", { name: "Pause" }).click()
                dbRows(
                  "select 1 from routine_run where routine_id = $1 and paused_at is not null",
                  [r.id],
                )
                cy.findByRole("button", { name: "Resume" }).click()
                dbRows(
                  "select 1 from routine_run where routine_id = $1 and paused_at is null",
                  [r.id],
                )

                // Step 1 done → a routine-sourced log for Water.
                cy.findByText("Done").click()
                cy.findByText("2/3").should("exist")
                dbRows(
                  `select 1 from habit_log where habit_id = $1 and day = $2::date
                     and status = 'done' and source = 'routine' and deleted_at is null`,
                  [a.id, TODAY],
                )
                // Step 2 skipped, then Back to it, then skipped again.
                cy.findByRole("button", { name: "Skip" }).click()
                cy.findByText("3/3").should("exist")
                dbRows(
                  "select 1 from routine_run where routine_id = $1 and current = 2",
                  [r.id],
                )
                cy.findByRole("button", { name: "Back" }).click()
                cy.findByText("2/3").should("exist")
                dbRows(
                  "select 1 from routine_run where routine_id = $1 and current = 1",
                  [r.id],
                )
                cy.findByRole("button", { name: "Skip" }).click()

                // Step 3 already logged today → Continue finishes the run.
                cy.findByText("✓ Already done today").should("exist")
                cy.findByRole("button", { name: "Continue" }).click()
                cy.location("pathname").should(
                  "eq",
                  `/habits/routines/${r.id}/summary`,
                )
                cy.findByText("Morning done!").should("exist")
                // Water done, Stretch skipped, Vitamins continued (counts done).
                cy.findAllByText("2/3").should("have.length.gte", 1)
                cy.findByText("skipped").should("exist")

                // The UI is ahead of the push: wait for the server's state.
                dbRows(
                  `select id from routine_run where routine_id = $1 and day = $2::date
                     and state = 'completed' and deleted_at is null`,
                  [r.id, TODAY],
                ).then(([x]) => {
                  dbRows(
                    `select string_agg(status, ',' order by position) as s
                       from routine_step_result where run_id = $1 and deleted_at is null
                     having string_agg(status, ',' order by position) = 'done,skipped,done'`,
                    [x.id],
                  )
                  apiUntil<{ state: string }>(
                    user,
                    `/habits/runs/${x.id}`,
                    (s) => JSON.stringify(s).includes("completed"),
                  )
                })
                none(
                  "select 1 from live_session where owner_id = $1 and deleted_at is null",
                  [user.id],
                )
                cy.findByRole("button", { name: "Done" }).click()
                cy.location("pathname").should("eq", "/today")
              }),
          ),
        ),
      )
    })
  })

  it("leaves a routine mid-run and resumes it from Today", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, "Water", "💧").then((a) =>
        seedHabit(user, "Stretch", "🧘").then((b) =>
          cy
            .liveApi<Row>(user, "POST", "/habits/routines", {
              name: "Morning",
              icon: "🌅",
              schedule: EVERY_DAY,
              steps: [
                { habit_id: a.id, minutes: 2 },
                { habit_id: b.id, minutes: 3 },
              ],
            })
            .then((r) => {
              signIn(user)
              pulled("Morning")
              // Today's routine card: Start.
              cy.findByText("Start").click()
              cy.location("pathname").should(
                "eq",
                `/habits/routines/${r.id}/play`,
              )
              cy.findByRole("button", { name: "Start" }).click()
              cy.findByText("1/2").should("exist")
              cy.findByText("Done").click()
              cy.findByText("2/2").should("exist")
              dbRows(
                "select 1 from routine_run where routine_id = $1 and current = 1",
                [r.id],
              )

              cy.findByRole("button", { name: "Leave routine" }).click()
              cy.location("pathname").should("eq", "/today")
              // The server releases the Live bar on exit; the run stays open.
              none(
                "select 1 from live_session where owner_id = $1 and deleted_at is null",
                [user.id],
              )
              dbRows(
                "select 1 from routine_run where routine_id = $1 and state = 'in_progress'",
                [r.id],
              )

              cy.findByRole("button", { name: /Resume 1\/2/ }).click()
              cy.location("pathname").should(
                "eq",
                `/habits/routines/${r.id}/play`,
              )
              cy.findByText("2/2").should("exist")
              cy.visit(`/habits/routines/${r.id}`)
              cy.findByRole("button", { name: /Resume · step 2\/2/ }).should(
                "exist",
              )
            }),
        ),
      )
    })
  })
})
