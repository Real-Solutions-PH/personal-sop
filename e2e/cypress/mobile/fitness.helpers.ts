// Pollers for the fitness live specs. The harness's eventually* commands try
// 20 times; on the shared, loaded E2E stack a single push can take 25 s+, so
// these poll for up to 90 s (same reasoning as finance.helpers.ts).
import type { LiveUser } from "./support"

const TRIES = 90

/** Poll Postgres (read-only) until the query returns at least ``min`` rows. */
export function rows(
  text: string,
  values: unknown[],
  min = 1,
  left = TRIES,
): Cypress.Chainable<Record<string, unknown>[]> {
  return cy
    .task<Record<string, unknown>[]>("sql", { text, values }, { log: false })
    .then((r) => {
      if (r.length >= min) return cy.wrap(r, { log: false })
      if (left <= 0)
        throw new Error(`SQL never returned ${min} row(s): ${text}`)
      cy.wait(1000, { log: false })
      return rows(text, values, min, left - 1)
    })
}

/** Poll an API GET as ``user`` until ``check`` passes. */
export function api<T>(
  user: LiveUser,
  path: string,
  check: (body: T) => boolean,
  left = TRIES,
): Cypress.Chainable<T> {
  return cy.liveApi<T>(user, "GET", path).then((body) => {
    if (check(body)) return cy.wrap(body, { log: false })
    if (left <= 0) throw new Error(`API ${path} never matched`)
    cy.wait(1000, { log: false })
    return api(user, path, check, left - 1)
  })
}

/** Sign in through the real Welcome → Sign in screens. As support.ts's
 * signInLive, but types into Email without clearing it first: under load the
 * field reports "disabled" during the Welcome → Sign in transition, and
 * `.clear()` fails on that while a plain type waits for it. */
export function signIn(user: LiveUser) {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.findByRole("textbox", { name: "Email" })
    .should("not.be.disabled")
    .type(user.email)
  cy.findByLabelText("Password").type(user.password, { log: false })
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 90000 }).should("eq", "/today")
}
