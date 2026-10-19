// Shared helpers for the tasks specs (not a spec: no ``.cy`` suffix).
import type { LiveUser } from "./support"

const pad = (n: number) => String(n).padStart(2, "0")

/** A device-local calendar day, ``offset`` days from today (YYYY-MM-DD). */
export function day(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface ServerTask {
  id: string
  title: string
  list_id: string | null
  due_date: string | null
  status: string
}

export interface ServerList {
  id: string
  name: string
}

/**
 * POST a seed row, retrying a 5xx: under the parallel E2E load the API
 * answers some requests with a 500 when its connection pool runs dry. The
 * client supplies the id, so a retry after a lost response cannot duplicate.
 */
const tokens = new Map<string, string>()

/** One password-grant token per user per spec (GoTrue is shared and busy). */
function tokenFor(user: LiveUser): Cypress.Chainable<string> {
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

function seed<T>(user: LiveUser, path: string, body: Record<string, unknown>) {
  const withId = { id: crypto.randomUUID(), ...body }
  const attempt = (left: number): Cypress.Chainable<T> =>
    tokenFor(user)
      .then((token) =>
        cy.request({
          method: "POST",
          url: `${Cypress.env("API_URL")}/api/v1${path}`,
          headers: { Authorization: `Bearer ${token}` },
          body: withId,
          failOnStatusCode: false,
        }),
      )
      .then((res) => {
        if (res.status < 300) return cy.wrap(res.body as T, { log: false })
        if (res.status === 409) return cy.wrap({ ...withId } as T)
        if (res.status < 500 || left <= 0)
          throw new Error(`seed ${path} failed: ${res.status}`)
        cy.wait(2000, { log: false })
        return attempt(left - 1)
      })
  return attempt(4)
}

/** Seed a task through the REST API (the UI step stays short). */
export const seedTask = (user: LiveUser, body: Record<string, unknown>) =>
  seed<ServerTask>(user, "/tasks/", body)

export const seedList = (user: LiveUser, body: Record<string, unknown>) =>
  seed<ServerList>(user, "/tasks/lists", body)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The task title control on a list surface (its name starts with the title). */
export const titleButton = (title: string) =>
  cy.findByRole("button", { name: new RegExp(`^${escapeRe(title)}`) })

/** The whole task row: the closest box holding both title and check. */
export const taskRow = (title: string) =>
  titleButton(title).closest("div:has([role=checkbox])")

/** Tick (or untick) a task's check on whatever surface shows its row. */
export const tick = (title: string) =>
  taskRow(title).within(() => cy.findByRole("checkbox").click())

/** Visit a path and wait until the pulled data shows ``text``. */
export function visitAndWait(path: string, text: string | RegExp) {
  cy.visit(path)
  cy.findAllByText(text, { timeout: 30000 }).should("have.length.at.least", 1)
}

// The shared stack serves several E2E sessions at once and the API can take
// tens of seconds per sync op under that load, so these polls allow 90 s
// where support.ts's ``eventuallyRows`` / ``eventuallyApi`` allow ~20 s.
const ATTEMPTS = 90

/** Poll Postgres (read-only) until the query returns at least ``min`` rows. */
export function rows(
  text: string,
  values: unknown[],
  min = 1,
): Cypress.Chainable<Record<string, unknown>[]> {
  const attempt = (
    left: number,
  ): Cypress.Chainable<Record<string, unknown>[]> =>
    cy
      .task<Record<string, unknown>[]>("sql", { text, values }, { log: false })
      .then((found) => {
        if (found.length >= min) return cy.wrap(found, { log: false })
        if (left <= 0)
          throw new Error(`SQL never returned ${min} row(s): ${text}`)
        cy.wait(1000, { log: false })
        return attempt(left - 1)
      })
  return attempt(ATTEMPTS)
}

/** Poll an API GET until ``check`` passes. */
export function api<T>(
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
  return attempt(ATTEMPTS)
}

// ---------------------------------------------------------------- sync

interface PushedOp {
  kind: string
  name: string
  id?: string
  data?: Record<string, unknown>
}

const sync = { inflight: 0, last: 0, pushes: [] as PushedOp[] }

/**
 * Watch the app's /sync traffic. Call at the start of a test, before any
 * visit (the intercept lives for the whole test, across reloads).
 */
export function trackSync() {
  sync.inflight = 0
  sync.last = 0
  sync.pushes = []
  // A reload aborts in-flight requests without a response.
  cy.on("window:before:load", () => {
    sync.inflight = 0
  })
  cy.intercept({ url: "**/api/v1/sync/**" }, (req) => {
    sync.inflight++
    sync.last = Date.now()
    if (req.url.includes("/sync/push"))
      sync.pushes.push(...((req.body as { ops: PushedOp[] }).ops ?? []))
    req.on("after:response", () => {
      sync.inflight = Math.max(0, sync.inflight - 1)
      sync.last = Date.now()
    })
  })
}

/**
 * Wait until no sync request is in flight and none started for ``quietMs``.
 *
 * Needed before an edit that follows a synced change on the same screen:
 * the sync engine merges a pull over the store without first capturing an
 * edit still inside its 400 ms debounce, so an edit made while a pull is
 * landing is silently lost (mobile/src/live/engine.ts ``apply``). Reported
 * as a defect; this wait keeps the tests about the screens.
 */
export function settled(quietMs = 1500) {
  cy.wrap(null, { log: false, timeout: 90000 }).should(() => {
    expect(sync.inflight, "sync requests in flight").to.eq(0)
    expect(Date.now() - sync.last, "ms since last sync request").to.be.gte(
      quietMs,
    )
  })
}

/** Wait until the app has SENT a push op matching ``match`` (not yet applied). */
export function pushed(match: (op: PushedOp) => boolean) {
  cy.wrap(null, { log: false, timeout: 30000 }).should(() => {
    expect(sync.pushes.some(match), "matching op pushed").to.eq(true)
  })
}

/** One task row straight from Postgres. */
export const dbTask = (id: string) =>
  cy
    .task<Record<string, unknown>[]>("sql", {
      text: "select * from task where id = $1",
      values: [id],
    })
    .its(0)
