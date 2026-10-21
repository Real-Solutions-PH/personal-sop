// Shared setup for the social specs: two named users in the one tenant.
import type { LiveUser } from "./support"

export interface SocialUser extends LiveUser {
  name: string
  handle: string
}

/** A fresh confirmed user with a name and handle, so others can find them. */
export function namedUser(label: string): Cypress.Chainable<SocialUser> {
  return cy.newLiveUser("social").then((u) => {
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`
    const handle = `${label.toLowerCase()}${tag}`.slice(0, 20)
    const name = `${label} ${tag}`
    return cy
      .liveApi(u, "PATCH", "/profile", { name, handle })
      .then(() => ({ ...u, name, handle }))
  })
}

/** Rows from Postgres, read-only. */
export function rows(text: string, values: unknown[] = []) {
  return cy.task<Record<string, unknown>[]>("sql", { text, values })
}

/** A real long press on the element showing ``text``, through Chrome's
 * input pipeline. React Native Web's gesture code calls setPointerCapture,
 * which synthetic events cannot satisfy. Chrome only. */
export function longPress(text: string, holdMs = 700) {
  // A real press hits whatever is on top: bring it clear of the tab bar,
  // let the list settle, then measure where it is now.
  cy.findByText(text).then(($e) => $e[0].scrollIntoView({ block: "center" }))
  cy.wait(500, { log: false })
  return cy.findByText(text).then(($e) => {
    const r = $e[0].getBoundingClientRect()
    const frame = window.top?.document.querySelector(
      "iframe.aut-iframe",
    ) as HTMLIFrameElement | null
    if (!frame) throw new Error("longPress: no AUT iframe")
    const f = frame.getBoundingClientRect()
    const scale = f.width / frame.offsetWidth
    const x = f.x + (r.x + r.width / 2) * scale
    const y = f.y + (r.y + r.height / 2) * scale
    const mouse = (type: string) =>
      Cypress.automation("remote:debugger:protocol", {
        command: "Input.dispatchMouseEvent",
        params: { type, x, y, button: "left", buttons: 1, clickCount: 1 },
      })
    return cy
      .wrap(mouse("mouseMoved"), { log: false })
      .then(() => mouse("mousePressed"))
      .wait(holdMs, { log: false })
      .then(() => mouse("mouseReleased"))
  })
}

/** An API call as ``user`` that may answer 204 (no body); yields the status. */
export function apiCall(
  user: LiveUser,
  method: string,
  path: string,
  body?: unknown,
): Cypress.Chainable<number> {
  return cy
    .task<string>(
      "liveToken",
      { email: user.email, password: user.password },
      { log: false },
    )
    .then((t) =>
      cy
        .request({
          method,
          url: `${Cypress.env("API_URL")}/api/v1${path}`,
          headers: { Authorization: `Bearer ${t}` },
          body: body as Cypress.RequestBody,
        })
        .its("status"),
    )
}

/** ``cy.signInLive`` for the social specs. On a busy host the sign-in
 * screen flips its Email field to disabled for a moment while the shared
 * helper types, which fails the test before it starts; sign-in itself is
 * covered by auth.cy.ts. Type through it, then insist every key landed. */
export function signIn(user: LiveUser) {
  cy.visit("/welcome")
  cy.findByRole("button", { name: "I already have an account" }).click()
  cy.findByRole("textbox", { name: "Email" })
    .clear({ force: true })
    .type(user.email, { force: true })
  cy.findByRole("textbox", { name: "Email" }).should("have.value", user.email)
  cy.findByLabelText("Password").type(user.password, {
    log: false,
    force: true,
  })
  cy.findByLabelText("Password").should("have.value", user.password)
  cy.findByRole("button", { name: "Sign in" }).click()
  cy.location("pathname", { timeout: 30000 }).should("eq", "/today")
}
