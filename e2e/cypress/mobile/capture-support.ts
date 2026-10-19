// Helpers shared by the capture, journal, Sol and AI-provider specs.
//
// The polls here have a 90 s budget instead of the harness's 20 s: several
// E2E sessions share one API, and a sync push or pull under that load can
// land well after 20 s. The assertions are unchanged; only the time allowed
// for them to become true is longer.
import type { LiveUser } from "./support"

const BUDGET_MS = 90_000
const STEP_MS = 1500

type Row = Record<string, unknown>

/** Poll Postgres (read-only) until the query returns at least ``min`` rows. */
export function rows(text: string, values: unknown[], min = 1) {
  let end = 0
  const attempt = (): Cypress.Chainable<Row[]> =>
    cy.task<Row[]>("sql", { text, values }, { log: false }).then((found) => {
      if (found.length >= min) return cy.wrap(found, { log: false })
      if (Date.now() > end)
        throw new Error(`SQL never returned ${min} row(s): ${text}`)
      cy.wait(STEP_MS, { log: false })
      return attempt()
    })
  return cy.then(() => {
    end = Date.now() + BUDGET_MS
    return attempt()
  })
}

/** Poll Postgres until the query returns no rows. */
export function noRows(text: string, values: unknown[]) {
  let end = 0
  const attempt = (): Cypress.Chainable<null> =>
    cy.task<Row[]>("sql", { text, values }, { log: false }).then((found) => {
      if (!found.length) return cy.wrap(null, { log: false })
      if (Date.now() > end) throw new Error(`SQL still returns rows: ${text}`)
      cy.wait(STEP_MS, { log: false })
      return attempt()
    })
  return cy.then(() => {
    end = Date.now() + BUDGET_MS
    return attempt()
  })
}

/** Poll the API as ``user`` until ``check`` passes. */
export function api<T>(user: LiveUser, path: string, check: (b: T) => boolean) {
  let end = 0
  const attempt = (): Cypress.Chainable<T> =>
    cy.liveApi<T>(user, "GET", path).then((body) => {
      if (check(body)) return cy.wrap(body, { log: false })
      if (Date.now() > end) throw new Error(`API ${path} never matched`)
      cy.wait(STEP_MS, { log: false })
      return attempt()
    })
  return cy.then(() => {
    end = Date.now() + BUDGET_MS
    return attempt()
  })
}

/**
 * Wait for the app's first sync pull after sign-in: the live runtime stores
 * its cursor once a pull lands. A capture sent before then races the first
 * sync on the server (see the capture spec's defect note).
 */
export function settle() {
  let end = 0
  const attempt = (): Cypress.Chainable<unknown> =>
    cy.window({ log: false }).then((win) => {
      const cursor = Number(win.localStorage.getItem("sop-live:cursor") ?? 0)
      if (cursor > 0) return cy.wrap<unknown>(cursor, { log: false })
      if (Date.now() > end) throw new Error("the first sync pull never landed")
      cy.wait(STEP_MS, { log: false })
      return attempt()
    })
  return cy.then(() => {
    end = Date.now() + BUDGET_MS
    return attempt()
  })
}

/**
 * Sign in through the real Welcome → Sign in screens. Same steps as `cy.signInLive`, but it waits for the sign-in form to
 * finish rendering first: under load the form re-renders after it appears,
 * and a field found before that is detached by the time it is typed into.
 */
export function signIn(user: LiveUser) {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.findByText("Welcome back").should("be.visible")
  cy.wait(750, { log: false })
  cy.findByRole("textbox", { name: "Email" }).type(user.email)
  cy.findByLabelText("Password").type(user.password, { log: false })
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 60000 }).should("eq", "/today")
  settle()
}

/** Reload a live screen and wait for its first pull again. */
export function revisit(path: string) {
  cy.visit(path)
  settle()
}

/** The newest capture with this text, once its status matches. */
export function captureRow(user: LiveUser, text: string, status = "%") {
  return rows(
    "select id, status, engine, error_code from capture where owner_id = $1 and text = $2 and status like $3 order by created_at desc",
    [user.id, text, status],
  ).then((r) => r[0] as { id: string; status: string; engine: string })
}

export interface CardRow {
  id: string
  kind: string
  state: string
  refs: string[]
  payload: Record<string, unknown>
}

/** Poll until the capture has a record card in ``state``. */
export function cardIn(user: LiveUser, captureId: string, state: string) {
  return rows(
    "select id, kind, state, refs, payload from record_card where capture_id = $1 and owner_id = $2 and state = $3",
    [captureId, user.id, state],
  ).then((r) => r[0] as unknown as CardRow)
}

/** Poll until the card's write log holds ``action``. */
export function logged(cardId: string, action: string) {
  return rows(
    "select action, actor from card_write_log where card_id = $1 and action = $2",
    [cardId, action],
  )
}

/** Send a message through the composer of the open Sol / capture screen. */
export function sendMessage(text: string) {
  cy.findByRole("textbox", { name: "Capture message" }).clear().type(text)
  cy.findByRole("button", { name: "Send" }).click()
}
