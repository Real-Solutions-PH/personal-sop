// Fitness · workouts (live): the logger, the rest timer, finish/discard,
// history and detail, all proven in the API and in Postgres.
//
// Inventory (screen → action → test):
// | Screen                     | Action                                   | Test |
// |----------------------------|------------------------------------------|------|
// | Train (/fitness)           | Start sheet → Empty workout              | W1   |
// | Train / start sheet        | Start from a template (Push A)           | W2   |
// | Train / start sheet        | Repeat last (Repeat last Push A)         | W2   |
// | Train / start sheet        | Only one active: a second start resumes  | W2   |
// | Logger (/fitness/workout)  | Add exercises (picker, search)           | W1   |
// | Logger                     | Add set                                  | W1   |
// | Logger                     | Edit set (weight, reps, kind)            | W1   |
// | Logger                     | Delete set                               | W1   |
// | Logger                     | Complete set                             | W1   |
// | Logger                     | Rest timer: starts on complete, +15, −15, Skip | W1 |
// | Logger                     | Exercise options → Note / Move / Remove  | W1   |
// | Logger                     | Rename workout (title tap)               | W1   |
// | Logger                     | Finish → "Remove them & finish"          | W1   |
// | Logger                     | Finish → "Mark all done & finish"        | W2   |
// | Logger                     | Discard workout                          | W2   |
// | Workouts (/fitness/workouts) | History list, open detail              | W3   |
// | Workout detail             | Repeat                                   | W3   |
// | Workout detail             | Options → Edit (logger ?edit) → Done     | W3   |
// | Workout detail             | Options → Save as template               | W3   |
// | Workout detail             | Options → Delete                         | W3   |
// | Cross-module               | Finish ticks a workout-linked habit (habit_log) | W2 |
import { api, rows, signIn } from "./fitness.helpers"
import type { LiveUser } from "./support"

const ACTIVE =
  "select id, name, status, template_id from workout where owner_id = $1 and status = 'in_progress' and deleted_at is null"

/** The live app does not seed the library itself (see report); one API read
 * does. Done before sign-in, so the account's first pull carries it. */
function seedLibrary(user: LiveUser) {
  cy.liveApi(user, "GET", "/fitness/overview")
}

function openFitness() {
  cy.visit("/fitness")
  cy.findByText("Push A", { timeout: 90000 }).should("exist")
}

function addExercise(name: string) {
  cy.findByRole("button", { name: "Add exercise" }).click()
  cy.findByRole("textbox", { name: "Search exercises" }).type(name)
  cy.findByText(name).click()
  cy.findByRole("button", { name: "Add 1 exercises" }).click()
  cy.findByText(name).should("exist")
}

describe("fitness · workouts (live)", { defaultCommandTimeout: 60000 }, () => {
  it("W1: empty workout — exercises, sets, rest timer, finish", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      signIn(user)
      openFitness()

      cy.findByRole("button", { name: "Start" }).click()
      cy.findByText("Empty workout").click()
      cy.location("pathname").should("eq", "/fitness/workout")
      rows(ACTIVE, [user.id]).then((found) => {
        expect(found).to.have.length(1)
        expect(found[0].name).to.match(/(Morning|Afternoon|Evening) workout/)
        expect(found[0].template_id).to.eq(null)
        const wid = found[0].id as string

        // Rename by tapping the title.
        cy.findByText(found[0].name as string).click()
        cy.findByRole("textbox", { name: "Workout name" })
          .clear()
          .type("E2E chest day")
        rows("select 1 from workout where id = $1 and name = 'E2E chest day'", [
          wid,
        ])

        addExercise("Barbell Bench Press")
        addExercise("Lateral Raise")
        rows(
          `select e.name, we.position from workout_exercise we join exercise e on e.id = we.exercise_id
           where we.workout_id = $1 and we.deleted_at is null order by we.position`,
          [wid],
          2,
        ).then((we) =>
          expect(we.map((r) => r.name)).to.deep.eq([
            "Barbell Bench Press",
            "Lateral Raise",
          ]),
        )

        const SETS = `select s.id, s.position, s.weight, s.reps, s.kind, s.completed_at, s.deleted_at
          from workout_set s join workout_exercise we on we.id = s.workout_exercise_id
          join exercise e on e.id = we.exercise_id
          where we.workout_id = $1 and e.name = 'Barbell Bench Press' order by s.position`

        rows(SETS, [wid]).then((before) => {
          const live = before.filter((r) => !r.deleted_at).length
          // A first-time lift plans one blank set; add three more (the
          // first "Add set" belongs to the bench press card).
          expect(live).to.eq(1)
          for (let i = 0; i < 3; i++)
            cy.findAllByText("Add set").first().click()
          rows(
            `${SETS.replace("order by", "and s.deleted_at is null order by")}`,
            [wid],
            live + 3,
          )
        })

        // Edit set 1: weight 60 kg × 8 reps.
        cy.findByRole("button", {
          name: "Barbell Bench Press set 1 weight",
        }).click()
        cy.findByRole("textbox", { name: "Weight (kg)" }).clear().type("60")
        cy.findByRole("textbox", { name: "Reps" }).clear().type("8")
        cy.findByRole("button", { name: "Save" }).click()
        rows(
          `${SETS.replace("order by", "and s.weight = 60 and s.reps = 8 and s.deleted_at is null order by")}`,
          [wid],
        )

        // Edit set 2's kind to warm-up, then delete the last set.
        cy.findByRole("button", {
          name: "Barbell Bench Press set 2 weight",
        }).click()
        cy.findByText("Warm-up").click()
        cy.findByRole("textbox", { name: "Weight (kg)" }).clear().type("40")
        cy.findByRole("button", { name: "Save" }).click()
        rows(
          `${SETS.replace("order by", "and s.kind = 'warmup' and s.weight = 40 and s.deleted_at is null order by")}`,
          [wid],
        )
        rows(
          `${SETS.replace("order by", "and s.deleted_at is null order by")}`,
          [wid],
        ).then((liveSets) => {
          const last = liveSets[liveSets.length - 1] as { id: string }
          cy.findAllByRole("button", {
            name: /^Barbell Bench Press set \S+ weight$/,
          })
            .last()
            .click()
          cy.findByRole("button", { name: "Delete set" }).click()
          rows(
            "select 1 from workout_set where id = $1 and deleted_at is not null",
            [last.id],
          )
        })

        // Complete the 60 × 8 set: completed_at on the server, rest starts.
        cy.findAllByRole("button", { name: "Complete set" }).first().click()
        rows(
          `${SETS.replace("order by", "and s.weight = 60 and s.completed_at is not null order by")}`,
          [wid],
        )
        rows(
          "select duration_sec, ends_at from rest_timer where owner_id = $1 and deleted_at is null and duration_sec = 120",
          [user.id],
        )
        cy.findByText(/Rest · 120s/).should("exist")
        cy.findByRole("button", { name: "+15" }).click()
        cy.findByText(/Rest · 135s/).should("exist")
        rows(
          "select 1 from rest_timer where owner_id = $1 and deleted_at is null and duration_sec = 135",
          [user.id],
        )
        cy.findByRole("button", { name: "−15" }).click()
        rows(
          "select 1 from rest_timer where owner_id = $1 and deleted_at is null and duration_sec = 120",
          [user.id],
        )
        cy.findByRole("button", { name: "Skip" }).click()
        cy.findByText(/Rest · /).should("not.exist")
        // (cy.liveApi cannot yield a null body, so GET /fitness/rest is
        // read through Postgres: the timer row is gone.)
        rows(
          "select 1 where not exists (select 1 from rest_timer where owner_id = $1 and deleted_at is null)",
          [user.id],
        )

        // Exercise options: a note, move Lateral Raise up, then remove it.
        cy.findByRole("button", { name: "Options for Lateral Raise" }).click()
        cy.findByRole("button", { name: "Note" }).click()
        cy.findByRole("textbox", { name: "Exercise note" }).type("Seat 4")
        rows(
          "select 1 from workout_exercise where workout_id = $1 and note = 'Seat 4'",
          [wid],
        )
        cy.findByRole("button", { name: "Options for Lateral Raise" }).click()
        cy.findByRole("button", { name: "Move up" }).click()
        // Poll until the move lands: Lateral Raise holds the lowest position.
        rows(
          `select 1 from (select e.name from workout_exercise we join exercise e on e.id = we.exercise_id
             where we.workout_id = $1 and we.deleted_at is null order by we.position limit 1) t
           where t.name = 'Lateral Raise'`,
          [wid],
        )
        cy.findByRole("button", { name: "Options for Lateral Raise" }).click()
        cy.findByRole("button", { name: "Remove" }).click()
        rows(
          `select 1 from workout_exercise we join exercise e on e.id = we.exercise_id
           where we.workout_id = $1 and e.name = 'Lateral Raise' and we.deleted_at is not null`,
          [wid],
        )

        // Finish with an unchecked set left: "Remove them & finish".
        cy.findByRole("button", { name: "Finish" }).click()
        cy.findByRole("button", { name: "Remove them & finish" }).click()
        cy.location("search").should("eq", "?tab=train")
        cy.findAllByText("E2E chest day done").should("have.length.at.least", 1)
        rows(
          "select ended_at from workout where id = $1 and status = 'finished' and ended_at is not null",
          [wid],
        )
        rows(
          `${SETS.replace("order by", "and s.deleted_at is null order by")}`,
          [wid],
        ).then((left) => {
          expect(left).to.have.length(1)
          expect(left[0].weight).to.eq(60)
          expect(left[0].completed_at).to.not.eq(null)
        })
        api<{
          status: string
          exercises: { exercise_name: string; sets: { weight: number }[] }[]
        }>(
          user,
          `/fitness/workouts/${wid}`,
          (b) =>
            b.status === "finished" &&
            b.exercises.length === 1 &&
            b.exercises[0].sets.length === 1,
        )
        api<{ active: unknown }>(
          user,
          "/fitness/overview",
          (b) => b.active === null,
        )
      })
    })
  })
  it("W2: template start, one active, mark-all finish ticks a linked habit, repeat, discard", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      cy.liveApi<{ id: string }>(user, "POST", "/habits/", {
        name: "Lift weights",
        link_workout: true,
      }).then((habit) => {
        signIn(user)
        openFitness()
        cy.task<{ id: string }[]>("sql", {
          text: "select id from workout_template where owner_id = $1 and name = 'Push A'",
          values: [user.id],
        }).then(([tpl]) => {
          cy.findByRole("button", { name: "Start" }).click()
          cy.findByText("Start workout").should("exist")
          // The sheet's row comes after the Up next card in the DOM.
          cy.findAllByText("Push A").last().click()
          cy.location("pathname").should("eq", "/fitness/workout")
          rows(`${ACTIVE} and name = 'Push A'`, [user.id]).then(([w]) => {
            expect(w.template_id).to.eq(tpl.id)
            const wid = w.id as string
            rows(
              "select 1 from workout_exercise where workout_id = $1 and deleted_at is null",
              [wid],
              5,
            )

            // A second start resumes the running workout, never a new one.
            cy.visit("/fitness?start=1")
            cy.findByText("Empty workout").click()
            cy.location("pathname").should("eq", "/fitness/workout")
            cy.findByText("Push A").should("exist")
            cy.task<unknown[]>("sql", {
              text: ACTIVE,
              values: [user.id],
            }).then((found) => expect(found).to.have.length(1))

            // Log one real set, then finish with "Mark all done".
            cy.findByRole("button", {
              name: "Barbell Bench Press set 1 weight",
            }).click()
            cy.findByRole("textbox", { name: "Weight (kg)" }).clear().type("50")
            cy.findByRole("button", { name: "Save" }).click()
            cy.findAllByRole("button", { name: "Complete set" }).first().click()
            cy.findByRole("button", { name: "Finish" }).click()
            cy.findByRole("button", {
              name: "Mark all done & finish",
            }).click()
            cy.findAllByText("Push A done").should("have.length.at.least", 1)
            rows(
              "select 1 from workout where id = $1 and status = 'finished'",
              [wid],
            )
            rows(
              `select s.completed_at from workout_set s join workout_exercise we on we.id = s.workout_exercise_id
                 where we.workout_id = $1 and s.deleted_at is null`,
              [wid],
              5,
            ).then((sets) =>
              expect(sets.every((r) => r.completed_at !== null)).to.eq(true),
            )

            // Cross-module: the workout-linked habit got its derived log.
            rows(
              "select day, source from habit_log where habit_id = $1 and deleted_at is null and source = 'workout'",
              [habit.id],
            )

            // Third way to start: "Repeat last Push A".
            cy.findAllByText("Start another workout")
              .filter(":visible")
              .first()
              .click()
            cy.findByText(/Repeat last Push A/).click()
            cy.location("pathname").should("eq", "/fitness/workout")
            rows(`${ACTIVE} and id <> $2 and name = 'Push A'`, [
              user.id,
              wid,
            ]).then(([r]) => {
              expect(r.name).to.eq("Push A")
              const rid = r.id as string
              rows(
                "select 1 from workout_exercise where workout_id = $1 and deleted_at is null",
                [rid],
                5,
              )
              cy.findByText("Discard workout").click()
              cy.location("pathname").should("eq", "/fitness")
              rows(
                "select 1 from workout where id = $1 and status = 'discarded' and deleted_at is not null",
                [rid],
              )
              api<{ active: unknown }>(
                user,
                "/fitness/overview",
                (b) => b.active === null,
              )
            })
          })
        })
      })
    })
  })

  it("W3: history, detail, edit, save as template, repeat, delete", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      cy.task<{ id: string }[]>("sql", {
        text: "select id from workout_template where owner_id = $1 and name = 'Legs A'",
        values: [user.id],
      }).then(([tpl]) => {
        // Seed one finished session through the API.
        cy.liveApi<{
          workout: {
            id: string
            exercises: { id: string; sets: { id: string }[] }[]
          }
        }>(user, "POST", "/fitness/workouts/start", {
          source: "template",
          template_id: tpl.id,
        }).then(({ workout }) => {
          const wid = workout.id
          const [squat] = workout.exercises
          cy.liveApi(user, "PATCH", `/fitness/workouts/${wid}`, {
            name: "E2E legs",
          })
          cy.liveApi(
            user,
            "PATCH",
            `/fitness/workouts/${wid}/exercises/${squat.id}/sets/${squat.sets[0].id}`,
            { weight: 100, reps: 5 },
          )
          cy.liveApi(user, "POST", `/fitness/workouts/${wid}/finish`, {
            unfinished: "done",
          })

          signIn(user)
          cy.visit("/fitness/workouts")
          cy.findByText("E2E legs", { timeout: 90000 }).click()
          cy.location("pathname").should("eq", `/fitness/workouts/${wid}`)
          cy.findByText("Back Squat").should("exist")
          cy.findByText(/100/).should("exist")

          // Options → Edit: change the squat set's reps in the logger.
          cy.findByRole("button", { name: "Workout options" }).click()
          cy.findByRole("button", { name: "Edit" }).click()
          cy.location("search").should("eq", `?edit=${wid}`)
          cy.findByRole("button", { name: "Back Squat set 1 reps" }).click()
          cy.findByRole("textbox", { name: "Reps" }).clear().type("6")
          cy.findByRole("button", { name: "Save" }).click()
          cy.findByRole("button", { name: "Done" }).click()
          cy.location("pathname").should("eq", `/fitness/workouts/${wid}`)
          rows(
            "select 1 from workout_set where id = $1 and reps = 6 and weight = 100",
            [squat.sets[0].id],
          )

          // Options → Save as template.
          cy.findByRole("button", { name: "Workout options" }).click()
          cy.findByRole("button", { name: "Save as template" }).click()
          cy.location("pathname").should("match", /^\/fitness\/templates\//)
          rows(
            "select id from workout_template where owner_id = $1 and name = 'E2E legs' and deleted_at is null",
            [user.id],
          ).then(([t]) =>
            rows(
              "select 1 from template_item where template_id = $1 and deleted_at is null",
              [t.id],
              3,
            ),
          )

          // Repeat from the detail: a new running workout with the same plan.
          cy.visit(`/fitness/workouts/${wid}`)
          cy.findByRole("button", { name: "Repeat" }).click()
          cy.location("pathname").should("eq", "/fitness/workout")
          rows(`${ACTIVE} and name = 'E2E legs'`, [user.id])

          // Options → Delete: a tombstone.
          cy.visit(`/fitness/workouts/${wid}`)
          cy.findByRole("button", { name: "Workout options" }).click()
          cy.findByRole("button", { name: "Delete" }).click()
          cy.location("pathname").should("eq", "/fitness/workouts")
          rows(
            "select 1 from workout where id = $1 and deleted_at is not null",
            [wid],
          )
          api<{ data: { id: string }[] }>(
            user,
            "/fitness/workouts",
            (b) => !b.data.some((w) => w.id === wid),
          )
        })
      })
    })
  })
})
