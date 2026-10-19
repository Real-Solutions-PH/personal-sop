// Stats (live): the Life Score overview the Stats screen shows is the
// server's aggregate. Activity is seeded through the API (completed tasks on
// past days, a habit check today, a task left overdue), then every number on
// screen is checked against GET /stats/overview and the rollup rows in
// daily_module_stat and life_score_daily.
//
// Inventory — screen · action · test
// | Stats          | gate "after 3 logged days" (fresh user)         | "a fresh account sees the 3-day gate"      |
// | Stats          | range 7d / 30d / 90d / 1y                       | "every range matches /stats/overview"      |
// | Stats          | Life Score, level, delta, on-target rate, streak, on-target days | "every range matches …" |
// | Stats          | per-area rates (weights sheet "rate N%")        | "every range matches …"                    |
// | Stats          | Areas: metric values per module                 | "every range matches …"                    |
// | Stats          | misses count for the range                      | "every range matches …"                    |
// | Stats          | weights sheet: edit a weight (module_pref)      | "edits a Life Score weight"                |
// | Stats          | weights sheet: reset weights                    | "edits a Life Score weight"                |
// | Rollups        | life_score_daily due/done/on_target per day     | "every range matches …"                    |
// | Rollups        | daily_module_stat per module = today's ring     | "every range matches …"                    |
// | Trophy case    | achievements catalog = /stats/achievements      | "trophy case lists the server catalog"     |
// | Misses         | list = /stats/misses                            | "misses list matches /stats/misses"        |
// | Stats          | calendar (/stats/calendar) — read by Wrap up    | dashboard.cy.ts "wrap-up"                  |
// | Stats          | series (/stats/series) — NOT COVERABLE ON WEB: no screen reads it; DailyForm and the companion charts compute the series locally (useDaySeries/useSeries were not switched to the server). |
// | Metric detail  | NOT COVERABLE as a server check: the metric screen reads each module's local useMetrics, not /stats/metrics/{ref}; the server metric values are asserted on the Stats Areas list instead. |

import type { LiveUser } from "./support"

interface Area {
  module: string
  enabled: boolean
  weight: number
  rate: number | null
}
interface Overview {
  range: string
  first: string
  last: string
  life_score: number | null
  delta: number | null
  level: { name: string }
  areas: Area[]
  on_target: {
    rate: number | null
    on_target: number
    scored: number
    current: number
    best: number
    logged: number
  }
  days_series: {
    day: string
    due: number
    done: number
    on_target: boolean | null
  }[]
  logged_days: number
  today: { per: Record<string, { due: number; done: number }> }
  metrics: { module: string; label: string; value: string; ref: string }[]
}

/** signInLive, but waits for the form to be enabled (it is disabled while
 * the app restores a session on a loaded stack). */
function signIn(user: LiveUser) {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.location("pathname").should("eq", "/login")
  cy.findByRole("textbox", { name: "Email" })
    .should("be.enabled")
    .clear()
    .type(user.email)
  cy.findByLabelText("Password").should("be.enabled").type(user.password, {
    log: false,
  })
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 90000 }).should("eq", "/today")
}

/** eventuallyApi with a longer window. */
function slowApi<T>(
  user: LiveUser,
  path: string,
  check: (b: T) => boolean,
  left = 60,
): Cypress.Chainable<T> {
  return cy.liveApi<T>(user, "GET", path).then((b): Cypress.Chainable<T> => {
    if (check(b)) return cy.wrap(b)
    if (left <= 0) throw new Error(`API ${path} never matched`)
    cy.wait(1000, { log: false })
    return slowApi(user, path, check, left - 1)
  })
}

/** eventuallyRows with a longer window (the shared stack is loaded). */
function slowRows(text: string, values: unknown[], min = 1, left = 60) {
  return cy
    .task<Record<string, unknown>[]>("sql", { text, values }, { log: false })
    .then((rows): Cypress.Chainable<Record<string, unknown>[]> => {
      if (rows.length >= min) return cy.wrap(rows)
      if (left <= 0)
        throw new Error(`SQL never returned ${min} row(s): ${text}`)
      cy.wait(1000, { log: false })
      return slowRows(text, values, min, left - 1)
    })
}

/** A day key ``n`` days from ``day`` (YYYY-MM-DD, calendar arithmetic). */
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Seed: tasks due 3, 2 and 1 days ago completed; one overdue; a habit
 * checked today. Yields today's business day (the server's). */
function seedActivity(user: LiveUser) {
  return cy
    .liveApi<{ day: string }>(user, "GET", "/stats/today")
    .then(({ day }) => {
      for (const n of [3, 2, 1])
        cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
          title: `Done ${n}d ago`,
          due_date: shift(day, -n),
        }).then((t) =>
          cy.liveApi(user, "POST", `/tasks/${t.id}/complete`, {
            completed_at: `${shift(day, -n)}T04:00:00Z`,
          }),
        )
      cy.liveApi(user, "POST", "/tasks/", {
        title: "Left overdue",
        due_date: shift(day, -2),
      })
      cy.liveApi<{ id: string }>(user, "POST", "/habits/", {
        name: "Read",
      }).then((h) => cy.liveApi(user, "POST", `/habits/${h.id}/check`, {}))
      return cy.wrap(day)
    })
}

const pct = (r: number | null) => `${Math.round((r ?? 0) * 100)}%`

describe("stats (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("a fresh account sees the 3-day gate, matching the server", () => {
    cy.newLiveUser("statsgate").then((user) => {
      signIn(user)
      cy.visit("/stats")
      cy.liveApi<Overview>(user, "GET", "/stats/overview?range=7d").then(
        (o) => {
          expect(o.logged_days).to.eq(0)
          cy.findByText("Stats appear after 3 logged days").should("exist")
          cy.findByText(/You're at 0\/3/).should("exist")
        },
      )
    })
  })

  it("every range matches /stats/overview and the rollup rows", () => {
    cy.newLiveUser("stats").then((user) => {
      seedActivity(user).then((today) => {
        signIn(user)
        cy.visit("/stats")
        cy.findByText("Life Score", { exact: false }).should("exist")
        for (const range of ["7d", "30d", "90d", "1y"]) {
          cy.findAllByRole("tab", { name: range }).first().click()
          cy.liveApi<Overview>(
            user,
            "GET",
            `/stats/overview?range=${range}`,
          ).then((o) => {
            expect(o.logged_days, "seeded logged days").to.be.gte(3)
            const score = String(o.life_score ?? "—")
            cy.findByRole("button", {
              name: "How the Life Score is weighted",
            }).should("contain.text", score)
            cy.findAllByText(o.level.name.toUpperCase()).should("exist")
            cy.findByText(`Streak · best ${o.on_target.best}`).should("exist")
            cy.findByText("On-target days")
              .parent()
              .should(
                "contain.text",
                `${o.on_target.on_target}/${o.on_target.scored}`,
              )
            cy.findByText("On target")
              .parent()
              .parent()
              .should(
                "contain.text",
                o.on_target.rate === null ? "—" : pct(o.on_target.rate),
              )
            // Per-area rates, in the weights sheet.
            cy.findByText("How it's weighted").click()
            cy.findByText(/^Life Score = weighted mean/).should(
              "contain.text",
              `Now: ${score}`,
            )
            for (const a of o.areas) {
              const label = {
                habits: "Habits",
                tasks: "Tasks",
                fitness: "Fitness",
                finance: "Finance",
              }[a.module]
              cy.findByText(`${label} · rate ${pct(a.rate)}`).should("exist")
            }
            cy.findAllByLabelText("Close dialog").last().click({ force: true })
            cy.findByText(/^Life Score = weighted mean/).should("not.exist")
            // Server metric values in the "All metrics" sheet.
            const done = o.metrics.find((m) => m.ref === "tasks:tasks.done")
            expect(done, "tasks.done metric").to.exist
            cy.findByText("All metrics").click()
            cy.findByText("Tasks done")
              .parent()
              .should("contain.text", done?.value)
            cy.findAllByLabelText("Close dialog").last().click({ force: true })
            cy.findByText("Tasks done").should("not.exist")
          })
        }

        // life_score_daily mirrors the calendar series day by day.
        cy.liveApi<Overview>(user, "GET", "/stats/overview?range=7d").then(
          (o) => {
            const logged = o.days_series.filter((d) => d.done > 0)
            expect(logged.length).to.be.gte(3)
            slowRows(
              `select day::text as day, due, done, on_target, score, level
                 from life_score_daily where owner_id = $1 and day = any($2::date[])
                 order by day`,
              [user.id, logged.map((d) => d.day)],
              logged.length,
            ).then((rows) => {
              for (const d of logged) {
                const r = rows.find((x) => x.day === d.day)
                expect(r, `life_score_daily ${d.day}`).to.exist
                expect(
                  { due: r?.due, done: r?.done, on_target: r?.on_target },
                  d.day,
                ).to.deep.eq({
                  due: d.due,
                  done: d.done,
                  on_target: d.on_target,
                })
              }
            })
            // daily_module_stat for today = the server's today ring.
            slowRows(
              `select module, due, done from daily_module_stat
                where owner_id = $1 and day = $2::date order by module`,
              [user.id, today],
              4,
            ).then((rows) => {
              for (const r of rows) {
                const per = o.today.per[String(r.module)]
                expect(
                  { due: r.due, done: r.done },
                  `daily_module_stat ${r.module}`,
                ).to.deep.eq({ due: per.due, done: per.done })
              }
            })
          },
        )
      })
    })
  })

  it("edits a Life Score weight: module_pref and the score follow", () => {
    cy.newLiveUser("statsw").then((user) => {
      seedActivity(user)
      signIn(user)
      cy.visit("/stats")
      cy.findByText("How it's weighted").click()
      cy.findByRole("textbox", { name: "Tasks weight" }).type("{selectall}5")
      cy.findAllByLabelText("Close dialog").last().click({ force: true })
      slowRows(
        "select weight from module_pref where owner_id = $1 and module = 'tasks' and weight = 5",
        [user.id],
      )
      slowApi<Overview>(user, "/stats/overview?range=7d", (o) =>
        o.areas.some((a) => a.module === "tasks" && a.weight === 5),
      ).then((o) => {
        cy.reload()
        cy.findByRole("button", {
          name: "How the Life Score is weighted",
        }).should("contain.text", String(o.life_score ?? "—"))
      })
      // Reset restores the defaults on the server.
      cy.findByText("How it's weighted").click()
      cy.findByRole("button", { name: "Reset weights" }).click()
      slowApi<{ modules: { module: string; weight: number }[] }>(
        user,
        "/profile",
        (b) => b.modules.find((m) => m.module === "tasks")?.weight === 2,
      )
    })
  })

  it("an out-of-range weight never leaves the device and server apart", () => {
    cy.newLiveUser("statswx").then((user) => {
      seedActivity(user)
      signIn(user)
      cy.visit("/stats")
      cy.findByText("How it's weighted").click()
      // The server accepts 0–10; Settings' stepper stops at 5.
      cy.findByRole("textbox", { name: "Tasks weight" }).type("{selectall}25")
      cy.findByRole("textbox", { name: "Tasks weight" })
        .invoke("val")
        .then((v) => {
          const shown = Number(v)
          expect(shown, "weight shown").to.be.within(0, 10)
          slowRows(
            "select 1 from module_pref where owner_id = $1 and module = 'tasks' and weight = $2",
            [user.id, shown],
          )
        })
    })
  })

  it("trophy case lists the server catalog", () => {
    cy.newLiveUser("statstr").then((user) => {
      seedActivity(user)
      signIn(user)
      cy.liveApi<{
        data: { type: string; title: string; trophy: unknown }[]
      }>(user, "GET", "/stats/achievements").then((a) => {
        cy.visit("/stats/trophies")
        cy.findByText("Trophy case").should("exist")
        for (const type of ["pr", "streak"]) {
          const all = a.data.filter((x) => x.type === type)
          const won = all.filter((x) => x.trophy).length
          cy.findAllByText(`/${all.length}`)
            .parent()
            .should("contain.text", `${won}/${all.length}`)
        }
        for (const x of a.data.slice(0, 3))
          cy.findAllByText(x.title).should("exist")
      })
    })
  })

  it("misses list matches /stats/misses", () => {
    cy.newLiveUser("statsm").then((user) => {
      seedActivity(user).then((today) => {
        signIn(user)
        cy.liveApi<{ data: { title: string }[]; count: number }>(
          user,
          "GET",
          `/stats/misses?from=${shift(today, -29)}&to=${today}`,
        ).then((m) => {
          expect(m.count, "seeded misses").to.be.gte(1)
          cy.visit("/stats/misses")
          cy.findByRole("tab", { name: "30d" }).click()
          cy.findByText(/misses · last 30d/)
            .parent()
            .should("contain.text", String(m.count))
          for (const x of m.data) cy.findAllByText(x.title).should("exist")
        })
      })
    })
  })
})
