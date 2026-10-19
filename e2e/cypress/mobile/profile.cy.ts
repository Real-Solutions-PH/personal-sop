// Profile & settings (live): Me, Edit profile and Settings. Every setting a
// screen can change is checked through GET /profile and in Postgres
// (user_profile, module_pref, identity, share_default).
//
// Inventory — screen · action · test
// | Edit profile | name                                         | "edits name, handle and identities"     |
// | Edit profile | handle                                       | "edits name, handle and identities"     |
// | Edit profile | add / edit / remove identity statement       | "edits name, handle and identities"     |
// | Edit profile | identity cap 3 (Add statement disappears)    | "edits name, handle and identities"     |
// | Edit profile | link an identity to a goal                   | "edits name, handle and identities"     |
// | Edit profile | profile photo — NOT COVERABLE ON WEB: opens the native image picker, and the live mapper does not sync the photo (device file URI vs server media id). |
// | Settings     | module on/off (confirm) → module_pref.enabled | "module switches and weights"          |
// | Settings     | weight − / + → module_pref.weight            | "module switches and weights"           |
// | Settings     | Reset to default weights                     | "module switches and weights"           |
// | Settings     | module links (Lists, Budgets, …)             | "module switches and weights" (one link) |
// | Settings     | appearance System / Light / Dark             | "appearance, privacy, day & time"       |
// | Settings     | privacy mode switch                          | "appearance, privacy, day & time"       |
// | Settings     | timezone + day start (read-only rows) = server timezone/day_start_hour | "appearance, privacy, day & time" |
// | Settings     | evening starts at                            | "appearance, privacy, day & time"       |
// | Settings     | on-target threshold 60–100%                  | "appearance, privacy, day & time"       |
// | Settings     | Reset share-card defaults                    | "resets share-card defaults"            |
// | Settings     | push rows: permission / morning / evening / weekly review = server push_* | "push preferences" |
// | Settings     | Allow (permission) — NOT COVERABLE: the live build still shows the prototype toast "Notification delivery is mocked"; no permission request, nothing stored (reported). |
// | Settings     | Send a test push — NOT COVERABLE: toast only, no server call (reported). |
// | Settings     | Export (JSON) — NOT COVERABLE: toast "stubbed in the prototype" (reported). |
// | Settings     | Sign out row — shows "Sign-in is mocked in the prototype" in live mode (reported); real sign-out is the Me row, covered by auth.cy.ts. |
// | Me           | privacy mode switch                          | "appearance, privacy, day & time"       |
// | Me           | identity row → goals / profile               | "edits name, handle and identities"     |
// | Me           | Start as a new user / Reset demo data — NOT COVERABLE: hidden in live mode by design (a live account is never wiped from the device). |
// | Today        | Hide amounts (privacy) header button         | "appearance, privacy, day & time"       |
// | Today        | Dismiss install nudge → install_dismissed    | "appearance, privacy, day & time"       |
// | Today        | Hide setup reminder → setup_hidden           | "appearance, privacy, day & time"       |

import type { LiveUser } from "./support"

interface Me {
  profile: {
    name: string
    handle: string | null
    timezone: string
    day_start_hour: number
    evening_start: string
    target_threshold: number
    appearance: string
    privacy_hidden: boolean
    install_dismissed: boolean
    setup_hidden: boolean
    push_permission: string
    push_morning: string | null
    push_evening: string | null
    push_review: boolean
  }
  modules: { module: string; enabled: boolean; weight: number }[]
  identities: { id: string; text: string; goal_id: string | null }[]
}

/** signInLive, but waits for the form to be enabled (it is disabled while
 * the app restores a session on a loaded stack). */
function signIn(user: LiveUser) {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.location("pathname").should("eq", "/login")
  // The first load of a spec can still be settling when the form shows;
  // type with force once the Sign in button is up.
  cy.findByRole("button", { name: "Sign in" }).should("exist")
  cy.findByRole("textbox", { name: "Email" }).type(user.email, { force: true })
  cy.findByLabelText("Password").type(user.password, {
    force: true,
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

/** Sign in and wait until the first pull has answered. */
function ready(user: LiveUser) {
  cy.intercept("GET", "**/api/v1/sync/pull*").as("firstPull")
  signIn(user)
  cy.wait("@firstPull", { timeout: 120000 })
}

describe("profile & settings (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("edits name, handle and identities", () => {
    cy.newLiveUser("prof").then((user) => {
      const handle = `prof.${Date.now()}`.slice(0, 20)
      // A goal to link an identity to.
      cy.liveApi<{ id: string }>(user, "POST", "/dashboard/goals", {
        metric: "tasks:tasks.done",
        label: "Tasks done",
        target: 5,
        unit: "",
        comparator: "gte",
        period: "week",
      }).then((goal) => {
        ready(user)
        cy.visit("/me/profile")
        cy.findByRole("textbox", { name: "Name" }).clear().type("Pat Profile")
        cy.findByRole("textbox", { name: "Handle" }).clear().type(handle)
        for (const [n, text] of [
          [1, "I read daily"],
          [2, "I ship weekly"],
          [3, "Temp statement"],
        ] as const) {
          cy.findByRole("button", { name: "Add statement" }).click()
          cy.findByRole("textbox", { name: `Identity statement ${n}` }).type(
            text,
          )
        }
        // Capped at three.
        cy.findByRole("button", { name: "Add statement" }).should("not.exist")
        cy.findByText("Identity statements · 3/3").should("exist")
        // Link the first to the goal; remove the third.
        cy.findAllByText("Tasks done ≥ 5 / week", { exact: false })
          .first()
          .click()
        cy.findByRole("button", { name: "Remove statement 3" }).click()
        cy.findByRole("button", { name: "Save" }).click()
        cy.location("pathname").should("eq", "/me")
        cy.findByText("Pat Profile").should("exist")

        slowRows(
          "select name, handle from user_profile where owner_id = $1 and name = 'Pat Profile' and handle = $2",
          [user.id, handle],
        )
        slowRows(
          "select text, goal_id::text as goal_id from identity where owner_id = $1 and deleted_at is null order by sort_order",
          [user.id],
          2,
        ).then((rows) => {
          expect(rows.map((r) => r.text)).to.deep.eq([
            "I read daily",
            "I ship weekly",
          ])
          expect(rows[0].goal_id).to.eq(goal.id)
          expect(rows[1].goal_id).to.eq(null)
        })
        slowApi<Me>(user, "/profile", (b) => b.identities.length === 2).then(
          (b) => {
            expect(b.profile.name).to.eq("Pat Profile")
            expect(b.profile.handle).to.eq(handle)
          },
        )
        // Me lists the linked identity with its goal; tapping goes to Goals.
        cy.findByText("“I read daily”").click()
        cy.location("pathname").should("eq", "/stats/goals")

        // Edit one statement and drop another; the server follows.
        cy.visit("/me/profile")
        cy.findByRole("textbox", { name: "Identity statement 2" })
          .clear()
          .type("I ship every week")
        cy.findByRole("button", { name: "Remove statement 1" }).click()
        cy.findByRole("button", { name: "Save" }).click()
        // Wait for the delete as well as the edit, then check the whole set.
        slowRows(
          `select 1 from identity where owner_id = $1 and deleted_at is not null
             and text = 'I read daily'`,
          [user.id],
        )
        slowRows(
          "select text from identity where owner_id = $1 and deleted_at is null",
          [user.id],
        ).then((rows) => {
          expect(rows.map((r) => r.text)).to.deep.eq(["I ship every week"])
        })
      })
    })
  })

  it("module switches and weights land in module_pref", () => {
    cy.newLiveUser("profmod").then((user) => {
      ready(user)
      cy.visit("/me/settings")
      // Turn Fitness off (confirm is auto-accepted), Finance off then on.
      cy.findByRole("switch", { name: "Fitness" }).click()
      cy.findByRole("switch", { name: "Finance" }).click()
      cy.findByRole("switch", { name: "Finance" }).click()
      // Weights: Tasks 2 → 4, Habits 3 → 2.
      cy.findByRole("button", { name: "Raise Tasks weight" }).click()
      cy.findByRole("button", { name: "Raise Tasks weight" }).click()
      cy.findByRole("button", { name: "Lower Habits weight" }).click()
      slowRows(
        `select module, enabled, weight from module_pref where owner_id = $1
            and ((module = 'fitness' and not enabled) or (module = 'finance' and enabled)
              or (module = 'tasks' and weight = 4) or (module = 'habits' and weight = 2))`,
        [user.id],
        4,
      )
      slowApi<Me>(user, "/profile", (b) =>
        b.modules.some((m) => m.module === "tasks" && m.weight === 4),
      ).then((b) => {
        const by = Object.fromEntries(b.modules.map((m) => [m.module, m]))
        expect(by.fitness.enabled).to.eq(false)
        expect(by.finance.enabled).to.eq(true)
        expect(by.habits.weight).to.eq(2)
      })
      // Reset to defaults.
      cy.findByRole("button", { name: "Reset to default weights" }).click()
      slowRows(
        "select 1 from module_pref where owner_id = $1 and module = 'tasks' and weight = 2",
        [user.id],
      )
      // A module link navigates into that section's settings.
      cy.findByText("Lists").click()
      cy.location("pathname").should("eq", "/tasks/lists")
    })
  })

  it("appearance, privacy, day & time, and Today's flags", () => {
    cy.newLiveUser("profset").then((user) => {
      ready(user)
      cy.liveApi<Me>(user, "GET", "/profile").then((b) => {
        cy.visit("/me/settings")
        // Read-only rows show the server's clock.
        cy.findByText(b.profile.timezone).should("exist")
        cy.findByText(
          `${String(b.profile.day_start_hour).padStart(2, "0")}:00`,
        ).should("exist")
      })
      cy.findByRole("tab", { name: "Dark" }).click()
      cy.findByRole("switch", { name: "Privacy mode" }).click()
      cy.findByRole("textbox", { name: "Evening starts at" })
        .clear()
        .type("19:15")
      cy.findByText("90%").click()
      slowRows(
        `select 1 from user_profile where owner_id = $1 and appearance = 'dark'
            and privacy_hidden and evening_start = '19:15' and target_threshold = 0.9`,
        [user.id],
      )
      slowApi<Me>(
        user,
        "/profile",
        (b) => b.profile.appearance === "dark" && b.profile.privacy_hidden,
      )

      // Privacy off again from Me; then from Today's header back on.
      cy.visit("/me")
      cy.findByRole("switch", { name: "Privacy mode" }).click()
      slowRows(
        "select 1 from user_profile where owner_id = $1 and not privacy_hidden",
        [user.id],
      )
      cy.visit("/today")
      cy.findByRole("button", { name: "Hide amounts" }).click()
      cy.findByRole("button", { name: "Show amounts" }).should("exist")
      slowRows(
        "select 1 from user_profile where owner_id = $1 and privacy_hidden",
        [user.id],
      )
      // Today: install nudge + setup reminder.
      cy.findByRole("button", { name: "Dismiss install nudge" }).click()
      cy.findByRole("button", { name: "Hide setup reminder" }).click()
      slowRows(
        "select 1 from user_profile where owner_id = $1 and install_dismissed and setup_hidden",
        [user.id],
      )
      // System appearance back.
      cy.visit("/me/settings")
      cy.findByRole("tab", { name: "System" }).click()
      slowRows(
        "select 1 from user_profile where owner_id = $1 and appearance = 'system'",
        [user.id],
      )
    })
  })

  it("push preferences on Settings are the server's", () => {
    cy.newLiveUser("profpush").then((user) => {
      cy.liveApi(user, "PATCH", "/profile", {
        push_morning: "06:10",
        push_evening: "22:05",
      })
      ready(user)
      cy.visit("/me/settings")
      cy.findByText("Morning digest")
        .parent()
        .parent()
        .should("contain.text", "06:10")
      cy.findByText("Evening wrap-up")
        .parent()
        .parent()
        .should("contain.text", "22:05")
      cy.findByText("Weekly review")
        .parent()
        .parent()
        .should("contain.text", "Sun 19:00")
      cy.findByText("Permission")
        .parent()
        .should("contain.text", "Not asked yet")
    })
  })

  it("resets share-card defaults", () => {
    cy.newLiveUser("profshare").then((user) => {
      cy.liveApi(user, "PUT", "/dashboard/share/life/defaults", {
        fields: { handle: true },
      })
      ready(user)
      slowRows(
        "select 1 from share_default where owner_id = $1 and template = 'life' and deleted_at is null",
        [user.id],
      )
      cy.visit("/me/settings")
      cy.findByText("Reset share-card defaults").click()
      cy.findByText("Share defaults reset").should("exist")
      slowRows(
        "select 1 from share_default where owner_id = $1 and template = 'life' and deleted_at is not null",
        [user.id],
      )
    })
  })
})
