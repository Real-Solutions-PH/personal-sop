// Shared steps for the finance live specs. Money on the server is integer
// centavos; SQL casts it to int so rows compare as numbers (pg returns
// bigint as a string).
import type { LiveUser } from "./support"

export interface SeededAccount {
  id: string
  name: string
}

/** An account written straight to the API (seed, not the step under test). */
export function seedAccount(
  user: LiveUser,
  body: {
    name: string
    type: string
    opening_minor: number
    color?: string
    in_projection?: boolean
  },
) {
  return cy.liveApi<SeededAccount>(user, "POST", "/finance/accounts", {
    color: "blue",
    ...body,
  })
}

/** The server's id for a seeded category slug ("food", "salary"...). */
export function categoryId(user: LiveUser, name: string) {
  return cy
    .liveApi<{ data: { id: string; name: string }[] }>(
      user,
      "GET",
      "/finance/categories",
    )
    .then((b) => {
      const hit = b.data.find((c) => c.name === name)
      if (!hit) throw new Error(`no category ${name}`)
      return hit.id
    })
}

/** Balances by account name, from the API (the server computes them). */
export function balances(user: LiveUser) {
  return cy
    .liveApi<{
      data: { name: string; balance_minor: number }[]
      net_worth_minor: number
    }>(user, "GET", "/finance/accounts")
    .then((b) => {
      const out: Record<string, number> = {}
      for (const a of b.data) out[a.name] = a.balance_minor
      return { ...out, $netWorth: b.net_worth_minor }
    })
}

/** Poll the API's balances until they match. */
export function eventuallyBalances(
  user: LiveUser,
  want: Record<string, number>,
) {
  return apiSoon<{ data: { name: string; balance_minor: number }[] }>(
    user,
    "/finance/accounts?limit=100",
    (b) =>
      Object.entries(want).every(([name, minor]) =>
        b.data.some((a) => a.name === name && a.balance_minor === minor),
      ),
  )
}

/** Sign in, then open a finance route once the first pull has landed. */
export function openFinance(user: LiveUser, path: string, waitFor?: string) {
  cy.signInLive(user)
  cy.visit(path)
  // The first pull can take over a minute while several suites share the API.
  if (waitFor) cy.findAllByText(waitFor, { timeout: 90000 }).should("exist")
}

// Sync is asynchronous, and with several suites sharing one API a push can
// take ~25 s to land: the finance specs poll for up to 60 s.
const TRIES = 60

/** Poll Postgres until ``text`` returns at least ``min`` rows. */
export function rowsSoon(
  text: string,
  values: unknown[],
  min = 1,
): Cypress.Chainable<Record<string, unknown>[]> {
  const attempt = (
    left: number,
  ): Cypress.Chainable<Record<string, unknown>[]> =>
    cy
      .task<Record<string, unknown>[]>("sql", { text, values }, { log: false })
      .then((rows) => {
        if (rows.length >= min) return cy.wrap(rows, { log: false })
        if (left <= 0)
          throw new Error(`SQL never returned ${min} row(s): ${text}`)
        cy.wait(1000, { log: false })
        return attempt(left - 1)
      })
  return attempt(TRIES)
}

/** Poll the API until ``check`` passes. */
export function apiSoon<T>(
  user: LiveUser,
  path: string,
  check: (body: T) => boolean,
): Cypress.Chainable<T> {
  const attempt = (left: number): Cypress.Chainable<T> =>
    cy.liveApi<T>(user, "GET", path).then((body) => {
      if (check(body)) return cy.wrap(body, { log: false })
      if (left <= 0) throw new Error(`API ${path} never matched`)
      cy.wait(1000, { log: false })
      return attempt(left - 1)
    })
  return attempt(TRIES)
}

// The server's derived ids: uuid5(namespace, "kind:parent:key") (RFC 4122
// name-based, SHA-1), computed here independently of the app's code.
const DERIVED_NAMESPACE = "6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5"

export function derivedId(kind: string, parent: string, key: string) {
  const ns = DERIVED_NAMESPACE.replace(/-/g, "")
  const nsBytes = Uint8Array.from(ns.match(/../g) ?? [], (h) =>
    Number.parseInt(h, 16),
  )
  const name = new TextEncoder().encode(`${kind}:${parent}:${key}`)
  const data = new Uint8Array(nsBytes.length + name.length)
  data.set(nsBytes)
  data.set(name, nsBytes.length)
  return cy.wrap(
    crypto.subtle.digest("SHA-1", data).then((buf) => {
      const b = new Uint8Array(buf).slice(0, 16)
      b[6] = (b[6] & 0x0f) | 0x50
      b[8] = (b[8] & 0x3f) | 0x80
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }),
    { log: false },
  )
}

/** A local calendar day, ``offset`` days from today (Asia/Manila host). */
export function dayKey(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Wait until the device has pushed everything it captured: the outbox in
 * storage is empty (captures run ~400 ms after a change, so wait first). */
export function outboxDrained() {
  cy.wait(1500, { log: false })
  cy.window({ timeout: 90000 })
    .its("localStorage")
    .invoke("getItem", "sop-live:outbox")
    .should((raw) => {
      expect(raw === null || raw === "[]", "outbox empty").to.eq(true)
    })
}

/** Click the toast's Undo while it is still showing (it lasts 6 s). */
export function clickUndo() {
  cy.findAllByText("Undo", { timeout: 5000 }).last().click()
}
