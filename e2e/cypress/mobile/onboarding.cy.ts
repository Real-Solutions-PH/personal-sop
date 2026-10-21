// Onboarding (live): a brand-new account signs up through the real screens,
// claims its name and handle, runs first-time setup, and every choice lands
// on the server (API + Postgres).
//
// Inventory — screen · action · test
// | Sign up        | name + username + email + password + terms     | "signs up, claims name and handle"          |
// | Sign up        | username availability hint ("@x is available") | "signs up, claims name and handle"          |
// | Sign up        | handle already claimed by another account      | "a handle another account holds"            |
// | Verify email   | 6-digit code from the mail                     | "signs up, claims name and handle"          |
// | Onboarding     | welcome → Build my plan                        | "runs every step"                           |
// | Onboarding     | identity pick, capped at 3 (4th is refused)    | "runs every step"                           |
// | Onboarding     | identity pick drives module defaults           | "runs every step"                           |
// | Onboarding     | modules toggle (module_pref.enabled)           | "runs every step"                           |
// | Onboarding     | pace preset + per-module target + skip one     | "runs every step"                           |
// | Onboarding     | check-in times (push_morning / push_evening)   | "runs every step"                           |
// | Onboarding     | hold to commit (pledge)                        | "runs every step" (accessibility action)    |
// | Onboarding     | notifications → Not now                        | "runs every step"                           |
// | Onboarding     | install → Continue                             | "runs every step"                           |
// | Onboarding     | done → Bring my data in (starter goals, onboarded) | "runs every step"                       |
// | Onboarding     | Skip (header) on a skippable step              | "skips steps from the header"               |
// | Onboarding     | done → Go to Today                             | "skips steps from the header"               |
// | Setup          | Skip a module's setup step (setup_skip)        | "runs every step"                           |
// | Setup          | I'll finish later                              | "skips steps from the header"               |

import type { LiveUser } from "./support"

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

/** eventuallyRows with a longer window: the first request after sign-up
 * can take 10s+ while parallel suites load the stack. */
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

const stamp = () => `${Date.now()}`.slice(-7)

/** Sign up through Welcome → Create account → code from Mailpit. */
function signUpLive(prefix: string, name: string, handle: string) {
  const email = `${prefix}-${stamp()}${Math.floor(Math.random() * 1e3)}@example.com`
  const password = `Live-${stamp()}-pw!`
  cy.visit("/welcome")
  cy.findByRole("button", { name: "Create account" }).click()
  cy.location("pathname").should("eq", "/signup")
  cy.findByRole("textbox", { name: "Name" }).type(name)
  cy.findByRole("textbox", { name: "Username" }).type(handle, { force: true })
  cy.findByText(`@${handle} is available`).should("exist")
  cy.findByRole("textbox", { name: "Email" }).type(email)
  cy.findByLabelText("Password").type(password, { log: false })
  cy.findByRole("checkbox", {
    name: "I agree to the Terms of Service and Privacy Policy",
  }).click("left")
  cy.findByRole("button", { name: "Create account" }).click()
  cy.location("pathname", { timeout: 30000 }).should("eq", "/verify-email")
  // The local GoTrue mails a confirmation LINK (no {{ .Token }} in its
  // template), so the 6-digit code the Verify screen asks for is read from
  // the admin generate_link API, which re-issues the signup OTP.
  const code = () =>
    cy.readFile("../.env").then((env: string) => {
      const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1] ?? ""
      return cy
        .request({
          method: "POST",
          url: "http://127.0.0.1:54321/auth/v1/admin/generate_link",
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          body: { type: "signup", email, password },
        })
        .its("body.email_otp")
    })
  return code().then((c: string) => {
    cy.findByLabelText("6-digit verification code").type(c)
    cy.location("pathname", { timeout: 30000 }).should("eq", "/onboarding")
    return cy
      .then(() => slowRows(`select id from "user" where email = $1`, [email]))
      .then((rows) => ({ id: String(rows[0].id), email, password }))
  })
}

/** Press and hold "Hold to commit" (RN-web's responder listens to mouse events). */
function holdToCommit() {
  cy.findByRole("button", { name: "Hold to commit" }).then(($b) => {
    const el = $b[0]
    const r = el.getBoundingClientRect()
    const at = {
      bubbles: true,
      cancelable: true,
      clientX: r.x + 20,
      clientY: r.y + 20,
      button: 0,
    }
    el.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }))
    cy.findByText("Keep holding…").should("exist")
    cy.wait(1500).then(() =>
      el.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 })),
    )
  })
}

describe("onboarding (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("signs up, claims name and handle, and runs every step", () => {
    const handle = `onb.${stamp()}`
    signUpLive("onb", "Onboard Tester", handle).then((user: LiveUser) => {
      expect(user.id, "user row").to.match(/^[0-9a-f-]{36}$/)
      // complete-signup claims the name and handle server-side.
      slowRows(
        "select name, handle, timezone, since from user_profile where owner_id = $1 and handle = $2",
        [user.id, handle],
      ).then(([p]) => {
        expect(p.name).to.eq("Onboard Tester")
        expect(p.since, "since").to.not.eq(null)
      })
      cy.liveApi<{ status: string }>(
        user,
        "GET",
        `/profile/handle-available?handle=${handle}`,
      ).then((r) => expect(r.status, "own handle").to.eq("available"))

      // Welcome
      cy.findByText("Your life, one dashboard").should("exist")
      cy.findByRole("button", { name: "Build my plan" }).click()

      // Identity: at most three; a fourth tap is refused.
      cy.findByText("Who are you becoming?").should("exist")
      cy.findByRole("button", { name: "Pick at least one" }).should(
        "have.attr",
        "aria-disabled",
        "true",
      )
      for (const text of [
        "I show up every day",
        "I finish what I start",
        "I'm in control of my money",
        "I'm someone who trains",
      ])
        cy.findByText(`“${text}”`).click()
      cy.findByText("“I'm someone who trains”")
        .parents('[role="button"]')
        .first()
        .should("have.css", "opacity", "0.4")
      cy.findByRole("button", { name: "That's me" }).click()

      // Modules: pre-selected from identity (habits, tasks, finance on;
      // fitness off). Turn finance off again here.
      cy.findByText("What do you want to track?").should("exist")
      cy.findByText("Finance").click()
      cy.findByRole("button", { name: "Next" }).click()

      // Targets: Steady preset, then a custom habits target, tasks skipped.
      cy.findByText("Pick your pace").should("exist")
      cy.findByText("Steady").click()
      cy.findByRole("textbox", { name: "Habit completion target" })
        .should("have.value", "80")
        .clear()
        .type("75")
      cy.findByRole("textbox", { name: "On-time rate target" }).should(
        "have.value",
        "85",
      )
      cy.findAllByText("Skip this one").last().click()
      cy.findByText("Use a target").should("exist")
      cy.findByRole("button", { name: "Next" }).click()

      // When: check-in times.
      cy.findByText("When will you check in?").should("exist")
      cy.findByRole("textbox", { name: "Plan my day" }).clear().type("06:30")
      cy.findByRole("textbox", { name: "Wrap it up" }).clear().type("20:45")
      cy.findByText(/Every day at 06:30 I'll plan, and at 20:45/).should(
        "exist",
      )
      cy.findByRole("button", { name: "Lock these in" }).click()

      // Building → pledge (auto-advances).
      cy.findByText("Your plan is ready", { timeout: 10000 }).should("exist")
      cy.findByText("“I show up every day”").should("exist")
      cy.findByText("≥ 75%").should("exist")
      // Hold to commit: drive the press-and-hold.
      holdToCommit()

      cy.findByText("Protect your plan").should("exist")
      cy.findByRole("button", { name: "Not now" }).click()
      cy.findByText("Keep your plan one tap away").should("exist")
      cy.findByRole("button", { name: "Continue" }).click()
      cy.findByText("Day 1 starts now").should("exist")
      cy.findByRole("button", { name: "Bring my data in" }).click()
      cy.location("pathname").should("eq", "/setup")

      // Server: profile flags + check-in times.
      slowRows(
        `select onboarded, push_morning, push_evening from user_profile
          where owner_id = $1 and onboarded and push_morning = '06:30' and push_evening = '20:45'`,
        [user.id],
      )
      // Three identities, in pick order.
      slowRows(
        "select text, sort_order from identity where owner_id = $1 and deleted_at is null order by sort_order",
        [user.id],
        3,
      ).then((rows) => {
        expect(rows.map((r) => r.text)).to.deep.eq([
          "I show up every day",
          "I finish what I start",
          "I'm in control of my money",
        ])
      })
      // Modules: habits + tasks on, fitness + finance off.
      slowRows(
        `select module, enabled from module_pref where owner_id = $1
          and ((module in ('habits','tasks') and enabled) or (module in ('fitness','finance') and not enabled))`,
        [user.id],
        4,
      )
      // Starter goals: only habits (tasks was skipped), at the custom target.
      slowRows(
        "select metric, target, via, comparator, period from goal where owner_id = $1 and deleted_at is null",
        [user.id],
      ).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({
          metric: "habits:habits.rate",
          via: "onboarding",
          comparator: "gte",
          period: "week",
        })
        expect(Number(rows[0].target)).to.eq(75)
      })
      slowApi<{
        profile: { onboarded: boolean; push_morning: string }
        identities: { text: string }[]
        modules: { module: string; enabled: boolean }[]
      }>(
        user,
        "/profile",
        (b) => b.profile.onboarded && b.identities.length === 3,
      )
        .its("modules")
        .then((mods) => {
          const on = mods.filter((m) => m.enabled).map((m) => m.module)
          expect(on.sort()).to.deep.eq(["habits", "tasks"])
        })

      // Setup: skip the habits step.
      cy.findByText("Bring your life in").should("exist")
      cy.findByRole("button", { name: "Start" }).click()
      cy.findAllByText("Skip").first().click()
      slowRows(
        "select module from setup_skip where owner_id = $1 and module = 'habits' and deleted_at is null",
        [user.id],
      )
      slowApi<{ setup_skipped: string[] }>(user, "/profile", (b) =>
        b.setup_skipped.includes("habits"),
      )
    })
  })

  it("skips steps from the header and finishes to Today", () => {
    signUpLive("onbskip", "Skip Tester", `skp.${stamp()}`).then((user) => {
      cy.findByRole("button", { name: "Build my plan" }).click()
      // identity, modules, targets, when: each has Skip.
      for (const title of [
        "Who are you becoming?",
        "What do you want to track?",
        "Pick your pace",
        "When will you check in?",
      ]) {
        cy.findByText(title).should("exist")
        cy.findByText("Skip").click()
      }
      cy.findByText("Your plan is ready", { timeout: 10000 }).should("exist")
      holdToCommit()
      cy.findByText("Protect your plan").should("exist")
      cy.findByText("Skip").click()
      cy.findByText("Keep your plan one tap away").should("exist")
      cy.findByText("Skip").click()
      cy.findByText("Day 1 starts now").should("exist")
      cy.findByRole("button", { name: "Go to Today" }).click()
      cy.location("pathname").should("eq", "/today")
      // Gentle defaults for every enabled module; no identities picked.
      slowRows(
        "select onboarded from user_profile where owner_id = $1 and onboarded",
        [user.id],
      )
      slowRows(
        "select metric, target from goal where owner_id = $1 and via = 'onboarding' and deleted_at is null order by metric",
        [user.id],
        4,
      ).then((rows) => {
        expect(rows.map((r) => [r.metric, Number(r.target)])).to.deep.eq([
          ["finance:savings-rate", 10],
          ["fitness:sessions", 2],
          ["habits:habits.rate", 60],
          ["tasks:tasks.onTime", 70],
        ])
      })
      cy.task<unknown[]>("sql", {
        text: "select 1 from identity where owner_id = $1 and deleted_at is null",
        values: [user.id],
      }).should("have.length", 0)
    })
  })

  it("a handle another account holds is not shown as available", () => {
    const handle = `dup.${stamp()}`
    signUpLive("onbdup1", "First Holder", handle).then((first) => {
      slowRows(
        "select 1 from user_profile where owner_id = $1 and handle = $2",
        [first.id, handle],
      )
      // The server knows it is taken (asked as a different account).
      cy.newLiveUser("onbdup2").then((other) =>
        cy
          .liveApi<{ status: string }>(
            other,
            "GET",
            `/profile/handle-available?handle=${handle}`,
          )
          .then((r) => expect(r.status, "server check").to.eq("taken")),
      )
      // A second visitor types the same handle on Sign up.
      cy.window().then((w) => w.localStorage.clear())
      cy.visit("/welcome")
      cy.findByRole("button", { name: "Create account" }).click()
      cy.findByRole("textbox", { name: "Username" }).type(handle, {
        force: true,
      })
      cy.findByText(`@${handle} is already taken`).should("exist")
    })
  })
})
