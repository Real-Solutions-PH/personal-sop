// Today (live): the day ring, its per-module rows and the Life Score / streak
// chips are the server's (GET /stats/today, /dashboard/today), and ticking an
// item on Today moves the server ring and the daily_module_stat rollup.
//
// Inventory — screen · action · test
// | Today | ring "x of y done · target N%" = /stats/today ring       | "ring and module rows match the server" |
// | Today | module rows (Habits n/m, Tasks n/m)                       | "ring and module rows match the server" |
// | Today | Life Score chip + streak chip = /stats/today              | "ring and module rows match the server" |
// | Today | complete a habit from its card → ring + daily_module_stat | "ticking on Today moves the server ring" |
// | Today | wrap-up / next-up card (evening vs day)                   | dashboard.cy.ts "wrap-up" (the screen it opens) |
// | Today | notifications bell + unread badge                        | dashboard.cy.ts "inbox"                 |
// | Today | Hide amounts, install nudge, setup reminder              | profile.cy.ts "appearance, privacy, …"  |
// | Today | module cards' own actions (habits, tasks, fitness, finance) | each module's own spec                |

import type { LiveUser } from "./support"

interface TodayStat {
  day: string
  ring: {
    due: number
    done: number
    per: Record<string, { due: number; done: number }>
  }
  life_score: number | null
  threshold: number
  streak: number
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

/** Seed today: two habits (one checked) and two tasks due (one done). */
function seedDay(user: LiveUser) {
  return cy
    .liveApi<{ day: string }>(user, "GET", "/stats/today")
    .then(({ day }) => {
      for (const [name, check] of [
        ["Meditate", true],
        ["Journal", false],
      ] as const)
        cy.liveApi<{ id: string }>(user, "POST", "/habits/", { name }).then(
          (h) => {
            if (check) cy.liveApi(user, "POST", `/habits/${h.id}/check`, {})
          },
        )
      for (const [title, done] of [
        ["Send invoice", true],
        ["Buy groceries", false],
      ] as const)
        cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
          title,
          due_date: day,
        }).then((t) => {
          if (done) cy.liveApi(user, "POST", `/tasks/${t.id}/complete`, {})
        })
      return cy.wrap(day)
    })
}

function assertRing(s: TodayStat) {
  cy.findByText(
    new RegExp(
      `^${s.ring.done} of ${s.ring.due} done · target ${Math.round(s.threshold * 100)}%`,
    ),
  ).should("exist")
  for (const [mod, label] of [
    ["habits", "Habits"],
    ["tasks", "Tasks"],
  ] as const) {
    const p = s.ring.per[mod]
    if (p.due > 0)
      cy.findAllByText(label)
        .filter(
          (_, el) => el.parentElement?.textContent?.includes("/") ?? false,
        )
        .first()
        .parent()
        .should("contain.text", `${Math.min(p.done, p.due)}/${p.due}`)
  }
  cy.findByRole("button", {
    name: `Life Score ${s.life_score ?? "not available yet"}`,
  }).should("exist")
  cy.findByRole("button", {
    name: new RegExp(`^On-target streak ${s.streak} days`),
  })
}

describe("today (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("ring and module rows match the server", () => {
    cy.newLiveUser("today").then((user) => {
      seedDay(user)
      signIn(user)
      slowApi<TodayStat>(
        user,
        "/stats/today",
        (s) => s.ring.per.habits.due === 2 && s.ring.per.tasks.done >= 1,
      ).then((s) => {
        cy.reload()
        assertRing(s)
        // /dashboard/today carries the same ring.
        cy.liveApi<{ ring: { due: number; done: number } }>(
          user,
          "GET",
          "/dashboard/today",
        ).then((b) => {
          expect({ due: b.ring.due, done: b.ring.done }).to.deep.eq({
            due: s.ring.due,
            done: s.ring.done,
          })
        })
      })
    })
  })

  it("ticking on Today moves the server ring and the rollup", () => {
    cy.newLiveUser("todaytick").then((user) => {
      seedDay(user).then((day) => {
        signIn(user)
        slowApi<TodayStat>(
          user,
          "/stats/today",
          (s) => s.ring.per.habits.due === 2,
        ).then((before) => {
          cy.reload()
          cy.findByRole("button", {
            name: "Complete Journal",
            timeout: 120000,
          }).click()
          slowApi<TodayStat>(
            user,
            "/stats/today",
            (s) => s.ring.per.habits.done === before.ring.per.habits.done + 1,
          ).then((after) => {
            expect(after.ring.done).to.eq(before.ring.done + 1)
            cy.reload()
            assertRing(after)
            slowRows(
              `select due, done from daily_module_stat where owner_id = $1
                    and day = $2::date and module = 'habits' and done = $3`,
              [user.id, day, after.ring.per.habits.done],
            ).then(([r]) => expect(r.due).to.eq(after.ring.per.habits.due))
          })
        })
      })
    })
  })
})
