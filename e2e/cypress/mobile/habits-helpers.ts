// Shared helpers for the habits*.cy.ts live specs.
import type { LiveUser } from "./support"

// The shared API serves several E2E sessions at once (writes take seconds),
// and the app's first sync after sign-in pushes its whole local state before
// it pulls. Give reads and pulls room before calling anything a failure.
Cypress.config("defaultCommandTimeout", 60000)
Cypress.config("responseTimeout", 90000)

const pad = (n: number) => String(n).padStart(2, "0")
/** The app's business day (the day starts 04:00 local), `offset` days away. */
export const businessDay = (offset = 0) => {
  const d = new Date(Date.now() - 4 * 3600000)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const EVERY_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6] }]

/** Poll Postgres (read-only) until the query returns at least one row. */
export const dbRows = (
  text: string,
  values: unknown[],
  left = 90,
): Cypress.Chainable<Record<string, unknown>[]> =>
  cy
    .task<Record<string, unknown>[]>("sql", { text, values }, { log: false })
    .then((rows) => {
      if (rows.length) return cy.wrap(rows)
      if (left <= 0) throw new Error(`SQL never returned a row: ${text}`)
      cy.wait(1000, { log: false })
      return dbRows(text, values, left - 1)
    })
/** Passes once the inner query matches nothing. */
export const none = (text: string, values: unknown[]) =>
  dbRows(`select 1 as gone where not exists (${text})`, values)

/** Poll the API until ``check`` passes. */
export const apiUntil = <T>(
  user: LiveUser,
  path: string,
  check: (body: T) => boolean,
  left = 60,
): Cypress.Chainable<T> =>
  cy.liveApi<T>(user, "GET", path).then((body) => {
    if (check(body)) return cy.wrap(body)
    if (left <= 0) throw new Error(`API ${path} never matched`)
    cy.wait(1000, { log: false })
    return apiUntil(user, path, check, left - 1)
  })

/** Sign in through Welcome → Sign in; waits out the form's busy state. */
export const signIn = (user: LiveUser) => {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.findByRole("textbox", { name: "Email" })
    .should("have.value", "")
    .and("not.be.disabled")
    .type(user.email)
  cy.findByLabelText("Password")
    .should("not.be.disabled")
    .type(user.password, { log: false })
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 60000 }).should("eq", "/today")
}

export type Row = { id: string; name?: string }
/** One row of GET /habits/ (the list wraps each habit with its stats). */
export type HabitListRow = { habit: Row; effective_status: string }
export const seedHabit = (user: LiveUser, body: Record<string, unknown>) =>
  cy.liveApi<Row>(user, "POST", "/habits/", { schedule: EVERY_DAY, ...body })

/** Wait for the app to show server data (the first pull can be slow). */
export const pulled = (text: string | RegExp) =>
  cy.findAllByText(text, { timeout: 120000 }).should("have.length.gte", 1)
