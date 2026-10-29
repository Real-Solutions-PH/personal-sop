// Onboarding (live): a brand-new account signs up through the real screens,
// claims its name and handle, runs onboarding and first-time setup, and every
// choice lands on the server (API + Postgres).
//
// Run against a disposable local stack (see cypress.mobile.config.ts): the
// local Supabase (`make supabase-up`), Postgres/Redis/MinIO, the API on :8765
// and the app as Expo web in live mode on :8082, e.g.
//
//   cd mobile && EXPO_PUBLIC_APP_MODE=live \
//     EXPO_PUBLIC_API_URL=http://localhost:8765 bunx expo start --web --port 8082
//   cd e2e && bunx cypress run --config-file cypress.mobile.config.ts \
//     --spec cypress/mobile/onboarding.cy.ts
//
// Toasts can sit over the bottom buttons, so taps are forced.
//
// Inventory — screen · action · test
// | Sign up        | name + username + email + password + terms     | "signs up and finishes setup into Today"    |
// | Sign up        | username availability hint ("@x is available") | "signs up and finishes setup into Today"    |
// | Sign up        | handle already claimed by another account      | "a handle another account holds"            |
// | Verify email   | 6-digit code → onboarding (never Today first)  | "signs up and finishes setup into Today"    |
// | Onboarding     | welcome → Build my plan, no Skip anywhere      | "signs up and finishes setup into Today"    |
// | Onboarding     | identity pick, capped at 3 (4th is refused)    | "signs up and finishes setup into Today"    |
// | Onboarding     | every feature starts selected                  | "every feature starts selected"             |
// | Onboarding     | features toggle (module_pref.enabled)          | "signs up and finishes setup into Today"    |
// | Onboarding     | pace preset + per-feature target + skip one    | "signs up and finishes setup into Today"    |
// | Onboarding     | gentle default target for every feature        | "every feature starts selected"             |
// | Onboarding     | check-in times (push_morning / push_evening)   | "signs up and finishes setup into Today"    |
// | Onboarding     | hold to commit (pledge)                        | both onboarding tests                       |
// | Onboarding     | notifications → Not now                        | both onboarding tests                       |
// | Onboarding     | done → Set up my workspace (goals, identities) | both onboarding tests                       |
// | Setup          | first run: no Skip, no "I'll finish later"     | "every feature starts selected"             |
// | Setup          | starter habit + tasks → Go to Today (onboarded)| "signs up and finishes setup into Today"    |

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

const tap = (name: string) =>
  cy.findByRole("button", { name }).click({ force: true })

/** Sign up through Welcome → Create account → the 6-digit code. */
function signUpLive(prefix: string, name: string, handle: string) {
  const email = `${prefix}-${stamp()}${Math.floor(Math.random() * 1e3)}@example.com`
  const password = `Live-${stamp()}-pw!`
  cy.visit("/welcome")
  tap("Create account")
  cy.location("pathname").should("eq", "/signup")
  // The form can be disabled for a moment while the app checks for a
  // stored session; wait for it before typing.
  cy.findByRole("textbox", { name: "Name" })
    .should("not.be.disabled")
    .type(name)
  cy.findByRole("textbox", { name: "Username" }).type(handle, { force: true })
  cy.findByText(`@${handle} is available`).should("exist")
  cy.findByRole("textbox", { name: "Email" }).type(email)
  cy.findByLabelText("Password").type(password, { log: false })
  cy.findByRole("checkbox", {
    name: "I agree to the Terms of Service and Privacy Policy",
  }).click("left")
  tap("Create account")
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
    // Straight into onboarding: a new account never sees Today first, even
    // before its first sync has landed.
    cy.location("pathname", { timeout: 30000 }).should("eq", "/onboarding")
    cy.findByText("Your life, one dashboard").should("exist")
    // Not bounced to Today and back once the first sync lands.
    cy.wait(5000)
    cy.location("pathname", { timeout: 2000 }).should("eq", "/onboarding")
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

/** Pledge → notifications (Not now) → done → setup. */
function commitAndSetUp() {
  cy.findByText("Your plan is ready", { timeout: 10000 }).should("exist")
  holdToCommit()
  cy.findByText("Protect your plan").should("exist")
  tap("Not now")
  cy.findByText("Day 1 starts now").should("exist")
  tap("Set up my workspace")
  cy.location("pathname").should("eq", "/setup")
  cy.findByText("Bring your life in").should("exist")
}

describe("onboarding (live)", {
  defaultCommandTimeout: 60000,
  responseTimeout: 120000,
}, () => {
  it("signs up and finishes setup into Today", () => {
    const handle = `onb.${stamp()}`
    signUpLive("onb", "Onboard Tester", handle).then((user: LiveUser) => {
      expect(user.id, "user row").to.match(/^[0-9a-f-]{36}$/)
      // complete-signup claims the name and handle server-side.
      slowRows(
        "select name, handle, since from user_profile where owner_id = $1 and handle = $2",
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

      // Welcome: onboarding has no way out.
      cy.findByText("Skip").should("not.exist")
      tap("Build my plan")

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
        cy.findByText(`“${text}”`).click({ force: true })
      cy.findByText("“I'm someone who trains”")
        .parents('[role="button"]')
        .first()
        .should("have.css", "opacity", "0.4")
      tap("That's me")

      // Features: all start selected. Keep habits and tasks.
      cy.findByText("What do you want to track?").should("exist")
      for (const label of ["Fitness", "Nutrition", "Focus", "Finance"])
        cy.findByText(label).click({ force: true })
      tap("Next")

      // Targets: Steady preset, a custom habits target, tasks skipped.
      cy.findByText("Pick your pace").should("exist")
      cy.findByText("Steady").click({ force: true })
      cy.findByRole("textbox", { name: "Habit completion target" })
        .should("have.value", "80")
        .clear()
        .type("75")
      cy.findByRole("textbox", { name: "On-time rate target" }).should(
        "have.value",
        "85",
      )
      cy.findAllByText("Skip this one").should("have.length", 2)
      cy.findAllByText("Skip this one").last().click({ force: true })
      cy.findByText("Use a target").should("exist")
      tap("Next")

      // When: check-in times.
      cy.findByText("When will you check in?").should("exist")
      cy.findByRole("textbox", { name: "Plan my day" }).clear().type("06:30")
      cy.findByRole("textbox", { name: "Wrap it up" }).clear().type("20:45")
      cy.findByText(/Every day at 06:30 I'll plan, and at 20:45/).should(
        "exist",
      )
      tap("Lock these in")

      // Pledge shows the plan before it is committed.
      cy.findByText("Your plan is ready", { timeout: 10000 }).should("exist")
      cy.findByText("“I show up every day”").should("exist")
      cy.findByText("≥ 75%").should("exist")
      commitAndSetUp()

      // Done hands over to setup: goals, identities and features are saved,
      // onboarding is not finished yet.
      slowRows(
        "select text from identity where owner_id = $1 and deleted_at is null order by sort_order",
        [user.id],
        3,
      ).then((rows) => {
        expect(rows.map((r) => r.text)).to.deep.eq([
          "I show up every day",
          "I finish what I start",
          "I'm in control of my money",
        ])
      })
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
        profile: { onboarded: boolean }
        modules: { module: string; enabled: boolean }[]
      }>(user, "/profile", (b) =>
        b.modules.some((m) => m.module === "finance" && !m.enabled),
      ).then((b) => {
        expect(b.profile.onboarded, "not until setup is done").to.eq(false)
        const on = b.modules.filter((m) => m.enabled).map((m) => m.module)
        expect(on.sort()).to.deep.eq(["habits", "tasks"])
      })

      // Setup: one step per kept feature, habits then tasks.
      tap("Start")
      cy.findByText("A few starter habits").should("exist")
      cy.findByText("💧 Drink water").click({ force: true })
      tap("Add 1 habits")
      cy.findByText("What's on your plate").should("exist")
      cy.findByRole("textbox", { name: "Your tasks, one per line" }).type(
        "renew passport",
      )
      tap("Add tasks")
      cy.findByText("You're all set").should("exist")
      tap("Go to Today")
      cy.location("pathname").should("eq", "/today")

      // Server: onboarding finished, check-in times, the setup data.
      slowRows(
        `select 1 from user_profile where owner_id = $1 and onboarded
          and push_morning = '06:30' and push_evening = '20:45'`,
        [user.id],
      )
      slowRows(
        "select 1 from habit where owner_id = $1 and name = 'Drink water' and deleted_at is null",
        [user.id],
      )
      slowRows(
        "select 1 from task where owner_id = $1 and title ilike 'renew passport%' and deleted_at is null",
        [user.id],
      )
      // Finished: Today stays put.
      cy.wait(3000)
      cy.location("pathname").should("eq", "/today")
    })
  })

  it("every feature starts selected, each with a gentle starter goal", () => {
    signUpLive("onball", "All Tester", `all.${stamp()}`).then((user) => {
      tap("Build my plan")
      // A trainer identity does not narrow the features.
      cy.findByText("“I'm someone who trains”").click({ force: true })
      tap("That's me")
      cy.findByText("What do you want to track?").should("exist")
      tap("Next")
      // One target per feature, all six, at the recommended gentle pace.
      cy.findByText("Pick your pace").should("exist")
      cy.findAllByText("Skip this one").should("have.length", 6)
      tap("Next")
      cy.findByText("When will you check in?").should("exist")
      tap("Lock these in")
      commitAndSetUp()

      slowRows(
        "select metric, target from goal where owner_id = $1 and via = 'onboarding' and deleted_at is null order by metric",
        [user.id],
        6,
      ).then((rows) => {
        expect(rows.map((r) => [r.metric, Number(r.target)])).to.deep.eq([
          ["finance:savings-rate", 10],
          ["fitness:sessions", 2],
          ["focus:goalDays", 3],
          ["habits:habits.rate", 60],
          ["nutrition:protein", 60],
          ["tasks:tasks.onTime", 70],
        ])
      })
      slowApi<{ modules: { module: string; enabled: boolean }[] }>(
        user,
        "/profile",
        (b) => b.modules.length > 0,
      ).then((b) => {
        expect(
          b.modules.every((m) => m.enabled),
          "all on",
        ).to.eq(true)
      })

      // Setup lists every feature and, on the first run, cannot be skipped.
      for (const title of [
        "Your accounts & balances",
        "A few starter habits",
        "Your training baseline",
        "Your daily targets",
        "Your daily focus goal",
        "What's on your plate",
      ])
        cy.findByText(title).should("exist")
      cy.findByText("I'll finish later").should("not.exist")
      // The starter gym library and focus defaults already count, so this
      // reads Continue rather than Start.
      cy.findByRole("button", { name: /^(Start|Continue)$/ }).click({
        force: true,
      })
      cy.findByText("Where your money lives today", { exact: false }).should(
        "exist",
      )
      // Finance's own Skip only moves on; it never ends onboarding early.
      tap("Skip")
      tap("Back to setup")
      cy.findByText("Bring your life in").should("exist")
      cy.findByRole("button", { name: "Go to Today" }).should("not.exist")
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
      tap("Create account")
      cy.findByRole("textbox", { name: "Username" }).type(handle, {
        force: true,
      })
      cy.findByText(`@${handle} is already taken`).should("exist")
    })
  })
})
