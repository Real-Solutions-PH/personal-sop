// Fitness · templates, exercise library, PRs / progression / stats (live).
//
// Inventory (screen → action → test):
// | Screen                          | Action                                     | Test |
// |---------------------------------|--------------------------------------------|------|
// | Templates (/fitness/templates)  | New template: name, add exercises, sets ±, reorder, save | L1 |
// | Template editor                 | Edit: rename, remove exercise, add exercise, save | L1 |
// | Template editor                 | Delete template, then Undo (restore)       | L1   |
// | Template editor                 | Start this template                        | L1   |
// | Exercises (/fitness/exercises)  | New exercise (name, equipment, muscle, reps, increment) | L2 |
// | Exercises                       | Search                                     | L2   |
// | Exercise detail                 | Edit exercise                              | L2   |
// | Exercise detail                 | Archive, Undo, archive again; Show archived | L2  |
// | Exercise detail                 | PR history matches the server's PRs        | L3   |
// | Logger                          | Progression: planned sets take the suggested increase | L3 |
// | Stats (/fitness/stats)          | Sessions and PRs match GET /fitness/stats  | L3   |
// | Train                           | "Progress · 8 weeks" key lifts appear      | L3   |
// (Exercises have no hard delete in the UI: archive is the delete.)
import { api, rows, signIn } from "./fitness.helpers"
import type { LiveUser } from "./support"

const TEMPLATE_ITEMS = `select e.name, ti.sets, ti.position from template_item ti
  join exercise e on e.id = ti.exercise_id
  where ti.template_id = $1 and ti.deleted_at is null order by ti.position`

function seedLibrary(user: LiveUser) {
  cy.liveApi(user, "GET", "/fitness/overview")
}

function pick(names: string[]) {
  cy.findByRole("button", { name: "Add exercise" }).click()
  for (const n of names) {
    cy.findByRole("textbox", { name: "Search exercises" }).clear().type(n)
    cy.findByText(n).click()
  }
  cy.findByRole("button", { name: `Add ${names.length} exercises` }).click()
}

interface WorkoutOut {
  id: string
  exercises: { id: string; exercise_name: string; sets: { id: string }[] }[]
}

/** One finished session from a template, with the bench sets given. */
function seedSession(
  user: LiveUser,
  templateId: string,
  bench: [number, number][],
) {
  cy.liveApi<{ workout: WorkoutOut }>(user, "POST", "/fitness/workouts/start", {
    source: "template",
    template_id: templateId,
  }).then(({ workout }) => {
    const we = workout.exercises.find(
      (e) => e.exercise_name === "Barbell Bench Press",
    )!
    const base = `/fitness/workouts/${workout.id}/exercises/${we.id}/sets`
    const ids = we.sets.map((x) => x.id)
    for (let i = ids.length; i < bench.length; i++)
      cy.liveApi<{ id: string }>(user, "POST", base, {}).then((x) =>
        ids.push(x.id),
      )
    cy.wrap(null).then(() => {
      ids.forEach((id, i) => {
        if (i < bench.length)
          cy.liveApi(user, "PATCH", `${base}/${id}`, {
            weight: bench[i][0],
            reps: bench[i][1],
          })
        else cy.liveApi(user, "DELETE", `${base}/${id}`)
      })
    })
    cy.liveApi(user, "POST", `/fitness/workouts/${workout.id}/finish`, {
      unfinished: "done",
    })
  })
}

describe("fitness · library (live)", { defaultCommandTimeout: 60000 }, () => {
  it("L1: templates — create, edit, delete + undo, start", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      signIn(user)
      cy.visit("/fitness/templates")
      cy.findByText("Push A", { timeout: 90000 }).should("exist")

      cy.findByRole("button", { name: "New template" }).click()
      cy.location("pathname").should("eq", "/fitness/templates/new")
      cy.findByRole("textbox", { name: "Template name" }).type("E2E upper")
      pick(["Dumbbell Curl", "Face Pull"])
      cy.findAllByRole("button", { name: "More sets" }).first().click()
      cy.findByText("4 sets").should("exist")
      cy.findByRole("button", { name: "Move Face Pull up" }).click()
      cy.findByRole("button", { name: "Save" }).click()
      cy.location("pathname").should("eq", "/fitness/templates")

      rows(
        "select id from workout_template where owner_id = $1 and name = 'E2E upper' and deleted_at is null",
        [user.id],
      ).then(([tpl]) => {
        const tid = tpl.id as string
        rows(TEMPLATE_ITEMS, [tid], 2).then((items) =>
          expect(items.map((r) => [r.name, r.sets])).to.deep.eq([
            ["Face Pull", 3],
            ["Dumbbell Curl", 4],
          ]),
        )
        api<{ data: { id: string; name: string }[] }>(
          user,
          "/fitness/templates",
          (b) => b.data.some((t) => t.id === tid),
        )

        // Edit: rename, drop Face Pull, add Leg Press.
        cy.findAllByText("E2E upper").filter(":visible").first().click()
        cy.location("pathname").should("eq", `/fitness/templates/${tid}`)
        cy.findByRole("textbox", { name: "Template name" })
          .clear()
          .type("E2E upper v2")
        cy.findAllByRole("button", { name: "Remove exercise" }).first().click()
        pick(["Leg Press"])
        cy.findByRole("button", { name: "Save" }).click()
        cy.location("pathname").should("eq", "/fitness/templates")
        rows(
          "select 1 from workout_template where id = $1 and name = 'E2E upper v2'",
          [tid],
        )
        rows(
          `${TEMPLATE_ITEMS.replace("order by", "and e.name = 'Leg Press' order by")}`,
          [tid],
        )
        cy.task<Record<string, unknown>[]>("sql", {
          text: TEMPLATE_ITEMS,
          values: [tid],
        }).then((items) =>
          expect(items.map((r) => [r.name, r.sets])).to.deep.eq([
            ["Dumbbell Curl", 4],
            ["Leg Press", 3],
          ]),
        )

        // Delete, then Undo from the toast.
        cy.findAllByText("E2E upper v2").filter(":visible").first().click()
        cy.findByText("Delete template").click()
        cy.location("pathname").should("eq", "/fitness/templates")
        rows(
          "select 1 from workout_template where id = $1 and deleted_at is not null",
          [tid],
        )
        cy.findByText("Undo").click()
        cy.findAllByText("E2E upper v2")
          .filter(":visible")
          .first()
          .should("exist")
        rows(
          "select 1 from workout_template where id = $1 and deleted_at is null",
          [tid],
        )

        // Start this template: a running workout carrying its plan.
        cy.findAllByText("E2E upper v2").filter(":visible").first().click()
        cy.findByRole("button", { name: "Start this template" }).click()
        cy.location("pathname").should("eq", "/fitness/workout")
        rows(
          "select id, template_id from workout where owner_id = $1 and status = 'in_progress' and name = 'E2E upper v2'",
          [user.id],
        ).then(([w]) => {
          expect(w.template_id).to.eq(tid)
          rows(
            "select 1 from workout_exercise where workout_id = $1 and deleted_at is null",
            [w.id],
            2,
          )
        })
      })
    })
  })

  it("L2: exercise library — create, search, edit, archive + undo", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      signIn(user)
      cy.visit("/fitness/exercises")
      cy.findByText("Barbell Bench Press", { timeout: 90000 }).should("exist")

      cy.findByRole("button", { name: "New exercise" }).click()
      cy.findByRole("textbox", { name: "Exercise name" }).type("E2E Cable Fly")
      cy.findByText("cable").click()
      cy.findByText("chest").click()
      cy.findByRole("button", { name: "Increase Rep max" }).click()
      cy.findByText("5 kg").click()
      cy.findByRole("button", { name: "Save exercise" }).click()

      const ROW =
        "select id, name, equipment, muscle, rep_min, rep_max, increment, archived from exercise where owner_id = $1 and name like 'E2E Cable Fly%'"
      rows(ROW, [user.id]).then(([ex]) => {
        expect(ex).to.include({
          name: "E2E Cable Fly",
          equipment: "cable",
          muscle: "chest",
          rep_min: 8,
          rep_max: 13,
          increment: 5,
          archived: false,
        })
        const id = ex.id as string
        api<{ data: { id: string }[] }>(user, "/fitness/exercises", (b) =>
          b.data.some((e) => e.id === id),
        )

        cy.findByRole("textbox", { name: "Search exercises" }).type("E2E")
        cy.findByText("Barbell Bench Press").should("not.exist")
        cy.findByText("E2E Cable Fly").click()
        cy.location("pathname").should("eq", `/fitness/exercises/${id}`)

        cy.findByRole("button", { name: "Edit exercise" }).click()
        cy.findByRole("textbox", { name: "Exercise name" })
          .clear()
          .type("E2E Cable Fly v2")
        cy.findByRole("button", { name: "Decrease Rep min" }).click()
        cy.findByRole("button", { name: "Save exercise" }).click()
        rows(`${ROW} and name = 'E2E Cable Fly v2' and rep_min = 7`, [user.id])

        cy.findByText("Archive exercise").click()
        rows(`${ROW} and archived`, [user.id])
        cy.findByText("Undo").click()
        rows(`${ROW} and not archived`, [user.id])
        cy.findByText("Archive exercise").click()
        rows(`${ROW} and archived`, [user.id])

        cy.visit("/fitness/exercises")
        cy.findByText("Barbell Bench Press", { timeout: 90000 }).should("exist")
        cy.findByText("E2E Cable Fly v2").should("not.exist")
        cy.findByText("Show archived").click()
        cy.findByText("E2E Cable Fly v2").should("exist")
      })
    })
  })

  it("L3: PRs, progression and stats agree with the server", () => {
    cy.newLiveUser("fitness").then((user) => {
      seedLibrary(user)
      cy.task<{ id: string }[]>("sql", {
        text: "select id from workout_template where owner_id = $1 and name = 'Push A'",
        values: [user.id],
      }).then(([tpl]) => {
        seedSession(user, tpl.id, [[60, 8]])
        seedSession(user, tpl.id, [
          [65, 10],
          [65, 10],
          [65, 10],
        ])
      })
      signIn(user)
      cy.task<{ id: string }[]>("sql", {
        text: "select id from exercise where owner_id = $1 and name = 'Barbell Bench Press'",
        values: [user.id],
      }).then(([bench]) => {
        cy.liveApi<{
          period: { sessions: number; prs: number }
          prs: { exercise_id: string }[]
        }>(user, "GET", "/fitness/stats?days=28").then((stats) => {
          expect(stats.period.sessions).to.eq(2)
          const benchPrs = stats.prs.filter(
            (p) => p.exercise_id === bench.id,
          ).length
          expect(benchPrs, "server PRs on bench").to.be.greaterThan(0)

          // Exercise detail: one PR row (with a Share PR button) per server PR.
          cy.visit(`/fitness/exercises/${bench.id}`)
          cy.findByText("PR history", { timeout: 90000 }).should("exist")
          cy.findAllByRole("button", { name: "Share PR" }).should(
            "have.length",
            Math.min(8, benchPrs),
          )
          cy.findByText("Best est. 1-rep max").should("exist")

          // Stats screen: sessions and PRs for 4 weeks.
          cy.visit("/fitness/stats")
          cy.contains(/^Sessions \(target \d+\)/)
            .prev()
            .should("have.text", String(stats.period.sessions))
          cy.contains(/^PRs/)
            .prev()
            .should("have.text", String(stats.period.prs))
        })

        // Train: the key-lift progress block appears once a lift has 2 sessions.
        cy.visit("/fitness")
        cy.findByText("Progress · 8 weeks").should("exist")

        // Progression: 65 × 10 on every set tops the 6–10 range, so the
        // next Push A plans +2.5 kg at the bottom of the range.
        cy.visit("/fitness?start=1")
        cy.findByText(/Repeat last Push A/).click()
        cy.location("pathname").should("eq", "/fitness/workout")
        rows(
          `select s.weight, s.reps from workout_set s join workout_exercise we on we.id = s.workout_exercise_id
           join workout w on w.id = we.workout_id
           where w.owner_id = $1 and w.status = 'in_progress' and we.exercise_id = $2 and s.deleted_at is null`,
          [user.id, bench.id],
          3,
        ).then((sets) =>
          expect(sets.map((r) => [r.weight, r.reps])).to.deep.eq([
            [67.5, 6],
            [67.5, 6],
            [67.5, 6],
          ]),
        )
      })
    })
  })
})
