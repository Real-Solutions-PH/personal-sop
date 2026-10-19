// Shared commands for the live-mode mobile E2E specs.
import "@testing-library/cypress/add-commands"

export interface LiveUser {
  id: string
  email: string
  password: string
}

declare global {
  namespace Cypress {
    interface Chainable {
      /** A fresh confirmed account, unique per call. */
      newLiveUser(prefix?: string): Chainable<LiveUser>
      /** Sign in through the real Welcome → Sign in screens; lands on Today. */
      signInLive(user: LiveUser): Chainable<void>
      /** Authenticated API call as ``user``; yields the parsed body. */
      liveApi<T = unknown>(
        user: LiveUser,
        method: string,
        path: string,
        body?: unknown,
      ): Chainable<T>
      /** Poll the API until ``check`` passes (sync is asynchronous). */
      eventuallyApi<T = unknown>(
        user: LiveUser,
        path: string,
        check: (body: T) => boolean,
      ): Chainable<T>
      /** Poll Postgres until the query returns at least ``min`` rows. */
      eventuallyRows(
        text: string,
        values: unknown[],
        min?: number,
      ): Chainable<Record<string, unknown>[]>
    }
  }
}

const tokens = new Map<string, string>()

Cypress.Commands.add("newLiveUser", (prefix = "e2e") => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`
  const user = {
    email: `${prefix}-${stamp}@example.com`,
    password: `Live-${stamp}-pw!`,
  }
  return cy.task<string>("createLiveUser", user).then((id) => ({ ...user, id }))
})

Cypress.Commands.add("signInLive", (user: LiveUser) => {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.findByRole("textbox", { name: "Email" }).clear().type(user.email)
  cy.findByLabelText("Password").type(user.password, { log: false })
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 30000 }).should("eq", "/today")
})

function token(user: LiveUser) {
  const cached = tokens.get(user.email)
  if (cached) return cy.wrap(cached, { log: false })
  return cy
    .task<string>(
      "liveToken",
      { email: user.email, password: user.password },
      { log: false },
    )
    .then((t) => {
      tokens.set(user.email, t)
      return t
    })
}

Cypress.Commands.add(
  "liveApi",
  (user: LiveUser, method: string, path: string, body?: unknown) =>
    token(user).then((t) =>
      cy
        .request({
          method,
          url: `${Cypress.env("API_URL")}/api/v1${path}`,
          headers: { Authorization: `Bearer ${t}` },
          body,
        })
        .its("body"),
    ),
)

Cypress.Commands.add(
  "eventuallyApi",
  (user: LiveUser, path: string, check: (b: never) => boolean) => {
    const attempt = (left: number): Cypress.Chainable<unknown> =>
      cy.liveApi(user, "GET", path).then((body) => {
        if (check(body as never)) return cy.wrap(body)
        if (left <= 0) throw new Error(`API ${path} never matched`)
        cy.wait(1000, { log: false })
        return attempt(left - 1)
      })
    return attempt(20)
  },
)

Cypress.Commands.add(
  "eventuallyRows",
  (text: string, values: unknown[], min = 1) => {
    const attempt = (
      left: number,
    ): Cypress.Chainable<Record<string, unknown>[]> =>
      cy
        .task<Record<string, unknown>[]>(
          "sql",
          { text, values },
          { log: false },
        )
        .then((rows) => {
          if (rows.length >= min) return cy.wrap(rows)
          if (left <= 0)
            throw new Error(`SQL never returned ${min} row(s): ${text}`)
          cy.wait(1000, { log: false })
          return attempt(left - 1)
        })
    return attempt(20)
  },
)

// The app's own dialogs use window.confirm on web; accept them in tests.
Cypress.on("window:before:load", (win) => {
  win.confirm = () => true
})
