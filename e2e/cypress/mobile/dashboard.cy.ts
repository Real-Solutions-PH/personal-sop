// Dashboard (live): goals, reviews, the evening wrap-up, miss notes, the
// notification inbox, share-card defaults and the trophy case. Each action
// is driven on its screen and confirmed through the API and in Postgres
// (goal, review, wrap_up, miss_note, notification, share_default,
// user_profile.seen_trophies, task, habit_log).
//
// Inventory — screen · action · test
// | Goals        | create (metric picker, target, period)         | "goals: create, edit, progress, archive, delete" |
// | Goals        | edit target                                     | "goals: …"                              |
// | Goals        | progress value = GET /dashboard/goals           | "goals: …"                              |
// | Goals        | archive / restore                               | "goals: …"                              |
// | Goals        | delete (from the edit sheet)                    | "goals: …"                              |
// | Reviews      | open last week, reflection, Mark done           | "reviews: mark a week done"             |
// | Wrap up      | ring = GET /dashboard/wrap-up ring              | "wrap-up: tick, move, let go, seal, reopen" |
// | Wrap up      | still-open list = GET /stats/calendar (today)   | "wrap-up: …"                            |
// | Wrap up      | Done <task>                                     | "wrap-up: …"                            |
// | Wrap up      | Move <task> to tomorrow                         | "wrap-up: …"                            |
// | Wrap up      | Didn't happen: <habit> (skip log)               | "wrap-up: …"                            |
// | Wrap up      | reflection + Done — seal the day                | "wrap-up: …"                            |
// | Wrap up      | Reopen day (unseal)                             | "wrap-up: …"                            |
// | Wrap up      | Say it instead (voice) — NOT COVERABLE ON WEB: opens the microphone capture. |
// | Misses       | Note a miss (quick chip + Save note)            | "misses: note, clear and move to today" |
// | Misses       | Clear a note                                    | "misses: …"                             |
// | Misses       | → Today on an overdue task                      | "misses: …"                             |
// | Inbox        | unread badge on Today = server unread           | "inbox: read and read all"        |
// | Inbox        | tap a notice → read                             | "inbox: …"                              |
// | Inbox        | Mark all read                                   | "inbox: …"                              |
// | Inbox        | dismiss — NOT COVERABLE ON WEB: left swipe only (gesture-handler Swipeable, no button); a synthetic pointer drag registers as a tap. |
// | Share card   | toggle a field, Remember as default, confirm    | "share: defaults and no ₱"              |
// | Share card   | no ₱ amounts on any card (finance template)     | "share: defaults and no ₱"              |
// | Trophy case  | opening it marks every trophy seen              | "trophies: seen"                        |

import type { LiveUser } from "./support"

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

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const today = (user: LiveUser) =>
  cy.liveApi<{ day: string }>(user, "GET", "/stats/today").its("day")

/** Sign in and wait until the first pull has landed (a sync cursor). */
function ready(user: LiveUser) {
  signIn(user)
  cy.window({ timeout: 120000 })
    .its("localStorage")
    .invoke("getItem", "sop-live:cursor")
    .should((c) => expect(Number(c), "sync cursor").to.be.greaterThan(0))
}

describe("dashboard (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("goals: create, edit, progress, archive, delete", () => {
    cy.newLiveUser("dashgoal").then((user) => {
      today(user).then((day) => {
        // Two tasks done this week, so "Tasks done" has a value.
        for (const n of [0, 1])
          cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
            title: `Seed ${n}`,
            due_date: day,
          }).then((t) =>
            cy.liveApi(user, "POST", `/tasks/${t.id}/complete`, {}),
          )
      })
      ready(user)
      cy.visit("/stats/goals")
      cy.findByRole("button", { name: "New goal" }).click()
      cy.findByText("Choose a metric").click()
      cy.findByRole("textbox", { name: "Search metrics" }).type("Tasks done")
      cy.findAllByText("Tasks done").last().click()
      cy.findByRole("textbox", { name: "Target" }).clear().type("3")
      cy.findByRole("button", { name: "Save goal" }).click()
      slowRows(
        `select id::text as id, metric, target, comparator, period, status, via
             from goal where owner_id = $1 and deleted_at is null`,
        [user.id],
      ).then(([g]) => {
        expect(g).to.include({
          metric: "tasks:tasks.done",
          comparator: "gte",
          period: "week",
          status: "active",
          via: "manual",
        })
        expect(Number(g.target)).to.eq(3)
        const id = String(g.id)
        // Progress shown = the server's.
        slowApi<{
          data: { id: string; value: string | null; hit: boolean }[]
        }>(user, "/dashboard/goals", (b) => b.data.length === 1).then((b) => {
          const p = b.data[0]
          expect(p.id).to.eq(id)
          cy.findByText("Tasks done", { exact: false })
            .parents('[role="button"]')
            .first()
            .should("contain.text", p.value ?? "—")
        })

        // Edit: target 3 → 4.
        cy.findByText("Tasks done", { exact: false }).click()
        cy.findByText("Edit goal").should("exist")
        cy.findByRole("textbox", { name: "Target" }).clear().type("4")
        cy.findByRole("button", { name: "Save goal" }).click()
        slowRows("select 1 from goal where id = $1 and target = 4", [id])

        // Archive, then restore from the Archived tab.
        cy.findByRole("button", { name: "Archive goal" }).click()
        slowRows("select 1 from goal where id = $1 and status = 'archived'", [
          id,
        ])
        cy.findByRole("tab", { name: /^Archived/ }).click()
        cy.findByRole("button", { name: "Restore goal" }).click()
        slowRows("select 1 from goal where id = $1 and status = 'active'", [id])
        slowApi<{ data: { status: string }[] }>(
          user,
          "/dashboard/goals",
          (b) => b.data[0]?.status === "active",
        )

        // Delete from the edit sheet (confirm auto-accepted).
        cy.findByRole("tab", { name: /^In play|^Hit/ }).click()
        cy.findAllByText("Tasks done", { exact: false }).first().click()
        cy.findByRole("button", { name: "Delete goal" }).click()
        slowRows(
          "select 1 from goal where id = $1 and deleted_at is not null",
          [id],
        )
        slowApi<{ data: unknown[] }>(
          user,
          "/dashboard/goals",
          (b) => b.data.length === 0,
        )
      })
    })
  })

  it("reviews: mark a week done with a reflection", () => {
    cy.newLiveUser("dashrev").then((user) => {
      ready(user)
      cy.visit("/stats/reviews")
      cy.findAllByText(/^Week of /)
        .first()
        .click()
      cy.location("pathname").should("match", /^\/stats\/reviews\/w-/)
      cy.location("pathname").then((path) => {
        const key = path.split("/").pop() as string
        cy.findByRole("textbox", { name: "Review reflection" }).type(
          "Calmer week, fewer late tasks.",
        )
        cy.findByRole("button", { name: "Mark done" }).click()
        cy.location("pathname").should("eq", "/stats/reviews")
        slowRows(
          "select done, reflection, done_at from review where owner_id = $1 and key = $2 and deleted_at is null",
          [user.id, key],
        ).then(([r]) => {
          expect(r.reflection).to.eq("Calmer week, fewer late tasks.")
          expect(r.done_at, "done_at").to.not.eq(null)
          expect(r.done, "review marked done").to.eq(true)
        })
        slowApi<{ data: { key: string; done: boolean }[] }>(
          user,
          "/dashboard/reviews",
          (b) => b.data.some((x) => x.key === key),
        ).then((b) => {
          expect(b.data.find((x) => x.key === key)?.done).to.eq(true)
        })
      })
    })
  })

  it("wrap-up: tick, move, let go, seal and reopen", () => {
    cy.newLiveUser("dashwrap").then((user) => {
      today(user).then((day) => {
        const ids: Record<string, string> = {}
        for (const title of ["Pay rent", "Call mom"])
          cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
            title,
            due_date: day,
          }).then((t) => {
            ids[title] = t.id
          })
        cy.liveApi<{ id: string }>(user, "POST", "/habits/", {
          name: "Stretch",
        }).then((h) => {
          ids.Stretch = h.id
        })
        ready(user)
        cy.visit("/today/wrap-up")
        // The ring and the open list are the server's.
        slowApi<{ ring: { due: number; done: number } }>(
          user,
          "/dashboard/wrap-up",
          (b) => b.ring.due >= 3,
        ).then((w) => {
          cy.findByText(`${w.ring.done}/${w.ring.due}`).should("exist")
        })
        cy.liveApi<{
          data: { title: string; done: boolean; module: string }[]
        }>(user, "GET", `/stats/calendar?from=${day}&to=${day}`).then((c) => {
          const open = c.data.filter(
            (i) => !i.done && ["habits", "tasks"].includes(i.module),
          )
          cy.findByText(`Still open · ${open.length}`).should("exist")
        })

        cy.findByRole("button", { name: "Done Pay rent" }).click()
        cy.findByRole("button", { name: "Move Call mom to tomorrow" }).click()
        cy.findByRole("button", { name: /^Didn't happen: .*Stretch$/ }).click()
        cy.then(() => {
          slowRows("select 1 from task where id = $1 and status = 'done'", [
            ids["Pay rent"],
          ])
          slowRows("select 1 from task where id = $1 and due_date = $2::date", [
            ids["Call mom"],
            shift(day, 1),
          ])
          slowRows(
            "select status from habit_log where habit_id = $1 and day = $2::date and status = 'skipped'",
            [ids.Stretch, day],
          )
        })

        cy.findByRole("textbox", { name: "One-line reflection" }).type(
          "Solid day.",
        )
        cy.findByRole("button", { name: "Done — seal the day" }).click()
        cy.location("pathname").should("eq", "/today")
        slowRows(
          `select on_target, done, due, reflection from wrap_up
              where owner_id = $1 and day = $2::date and deleted_at is null`,
          [user.id, day],
        ).then(([w]) => {
          expect(w.reflection).to.eq("Solid day.")
        })
        slowApi<{ sealed: { reflection: string | null } | null }>(
          user,
          "/dashboard/wrap-up",
          (b) => b.sealed?.reflection === "Solid day.",
        )

        // Reopen.
        cy.visit("/today/wrap-up")
        cy.findByText(/^Sealed at/).should("exist")
        cy.findByRole("button", { name: "Reopen day" }).click()
        slowRows(
          "select 1 from wrap_up where owner_id = $1 and day = $2::date and deleted_at is not null",
          [user.id, day],
        )
        slowApi<{ sealed: unknown }>(
          user,
          "/dashboard/wrap-up",
          (b) => b.sealed === null,
        )
      })
    })
  })

  it("misses: note, clear and move to today", () => {
    cy.newLiveUser("dashmiss").then((user) => {
      today(user).then((day) => {
        cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
          title: "Renew license",
          due_date: shift(day, -2),
        }).then((t) => {
          const key = `task-overdue:${t.id}`
          ready(user)
          cy.visit("/stats/misses")
          cy.findByText("Overdue 2d: Renew license").should("exist")
          cy.findByText("Note").click()
          cy.findByText("Work ran late").click()
          cy.findByRole("button", { name: "Save note" }).click()
          slowRows(
            "select note from miss_note where owner_id = $1 and miss_key = $2 and deleted_at is null",
            [user.id, key],
          ).then(([n]) => expect(n.note).to.eq("Work ran late"))
          slowApi<{ data: { id: string; note: string | null }[] }>(
            user,
            `/stats/misses?from=${shift(day, -6)}&to=${day}`,
            (b) =>
              b.data.some((m) => m.id === key && m.note === "Work ran late"),
          )
          // Clear it.
          cy.findByText("Edit note").click()
          cy.findByRole("button", { name: "Clear" }).click()
          slowRows(
            "select 1 from miss_note where owner_id = $1 and miss_key = $2 and deleted_at is not null",
            [user.id, key],
          )
          // → Today reschedules the task.
          cy.findByText("→ Today").click()
          slowRows("select 1 from task where id = $1 and due_date = $2::date", [
            t.id,
            day,
          ])
        })
      })
    })
  })

  it("inbox: read and read all", () => {
    cy.newLiveUser("dashinbox").then((user) => {
      const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString()
      for (const [title, m] of [
        ["Call the bank", 3],
        ["Book flights", 2],
        ["Water plants", 1],
      ] as const)
        cy.liveApi(user, "POST", "/tasks/", {
          title,
          remind: true,
          remind_at: ago(m),
        })
      sendReminders(user)
      slowRows(
        "select id::text as id, title from notification where owner_id = $1 and deleted_at is null",
        [user.id],
        3,
      ).then((rows) => {
        const id = (title: string) =>
          String(rows.find((r) => r.title === title)?.id)
        ready(user)
        cy.visit("/today")
        cy.liveApi<{ unread: number }>(
          user,
          "GET",
          "/dashboard/notifications",
        ).then((n) => {
          expect(n.unread).to.eq(3)
          cy.findByRole("button", { name: "Notifications, 3 unread" }).click()
        })
        cy.location("pathname").should("eq", "/today/inbox")
        // Tap one: read on the server, and it opens the task.
        cy.findByText("Call the bank").click()
        cy.location("pathname").should("match", /^\/tasks\/task\//)
        slowRows("select 1 from notification where id = $1 and read", [
          id("Call the bank"),
        ])
        // Mark all read.
        cy.findByText("Mark all read").click()
        slowRows(
          "select 1 from notification where owner_id = $1 and deleted_at is null and read",
          [user.id],
          3,
        )
        slowApi<{ unread: number; data: { title: string }[] }>(
          user,
          "/dashboard/notifications",
          (b) => b.unread === 0,
        ).then((b) => {
          expect(b.data.map((x) => x.title).sort()).to.deep.eq([
            "Book flights",
            "Call the bank",
            "Water plants",
          ])
        })
      })
    })
  })

  it("share: defaults are remembered and no ₱ ever shows", () => {
    cy.newLiveUser("dashshare").then((user) => {
      // A finance account with money in it, so a leak would be visible.
      cy.liveApi(user, "POST", "/finance/accounts", {
        name: "Wallet",
        type: "cash",
        opening_minor: 1234500,
      })
      ready(user)
      cy.visit("/stats/share", {
        onBeforeLoad(w) {
          Object.defineProperty(w.navigator, "share", {
            value: () => Promise.resolve(),
            configurable: true,
          })
        },
      })
      cy.findByText(/^show on card$/i).should("exist")
      cy.findByText("Handle").click()
      cy.findByRole("button", { name: "Share" }).click()
      cy.findByText("Privacy check").should("exist")
      cy.findByText("No ₱ amounts (never allowed)").should("exist")
      cy.findByText(/Remember these as defaults for Life Score/).click()
      cy.findByRole("button", { name: "Confirm & share" }).click()
      slowRows(
        "select fields from share_default where owner_id = $1 and template = 'life' and deleted_at is null",
        [user.id],
      ).then(([r]) => {
        expect((r.fields as Record<string, boolean>).handle).to.eq(true)
      })
      slowApi<{ key: string; fields: { key: string; on: boolean }[] }[]>(
        user,
        "/dashboard/share/templates",
        (b) =>
          !!b
            .find((t) => t.key === "life")
            ?.fields.find((f) => f.key === "handle")?.on,
      )
      // No ₱ on any card, on the server or on screen.
      for (const t of ["life", "weekly", "monthly", "finance", "profile"])
        cy.liveApi(user, "GET", `/dashboard/share/${t}/card`).then((card) =>
          expect(JSON.stringify(card), `${t} card`).not.to.contain("₱"),
        )
      cy.visit("/stats/share?t=finance")
      cy.findByText(/^show on card$/i).should("exist")
      cy.get("#root")
        .invoke("text")
        .then((text) => {
          const amounts = text.match(/₱\s?[\d,.]+/g)
          expect(amounts, "₱ amounts on the share screen").to.eq(null)
        })
    })
  })

  it("trophies: opening the case marks them seen", () => {
    cy.newLiveUser("dashtro").then((user) => {
      today(user).then((day) => {
        cy.liveApi<{ id: string }>(user, "POST", "/tasks/", {
          title: "Won",
          due_date: shift(day, -1),
        }).then((t) =>
          cy.liveApi(user, "POST", `/tasks/${t.id}/complete`, {
            completed_at: `${shift(day, -1)}T04:00:00Z`,
          }),
        )
      })
      cy.liveApi<{ data: { trophy: { id: string } | null }[] }>(
        user,
        "GET",
        "/stats/achievements",
      ).then((a) => {
        const won = a.data.flatMap((x) => (x.trophy ? [x.trophy.id] : []))
        expect(won.length, "seeded trophies").to.be.gte(1)
        ready(user)
        cy.visit("/stats/trophies")
        cy.findByText("Trophy case").should("exist")
        slowRows(
          "select seen_trophies from user_profile where owner_id = $1 and seen_trophies @> $2::jsonb",
          [user.id, JSON.stringify(won)],
        )
      })
    })
  })
})
