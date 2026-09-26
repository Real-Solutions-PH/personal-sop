// Custom commands shared by every spec. UI login is the reliable path for
// Supabase auth (@supabase/ssr manages chunked sb-*-auth-token cookies —
// forging them from a direct GoTrue request is fragile), so sessions are
// established through the real login form and cached with cy.session.

export type UserPublic = {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  is_superuser: boolean
}

declare global {
  namespace Cypress {
    interface Chainable {
      /** Shorthand for `[data-testid=…]`. */
      getByTestId(testId: string): Chainable<JQuery<HTMLElement>>
      /** Log in through the UI, cached via cy.session across specs. */
      loginAs(email: string, password: string): Chainable<void>
      /** Log in as FIRST_SUPERUSER, cached via cy.session across specs. */
      loginAsSuperuser(): Chainable<void>
      /** Plain (uncached) UI login — lands on / and asserts the welcome toast. */
      logInUser(email: string, password: string): Chainable<void>
      /** Log out through the user menu; ends on /login. */
      logOutUser(): Chainable<void>
      /** Sign up through the UI; Supabase signs out and routes to /login. */
      signUpNewUser(
        name: string,
        email: string,
        password: string,
      ): Chainable<void>
      /** Create a verified user through the backend's private API. */
      createUserViaApi(email: string, password: string): Chainable<UserPublic>
      /** Poll Mailpit for the Supabase recovery link sent to `email`. */
      findRecoveryLink(email: string): Chainable<string>
      /**
       * Open a Supabase /auth/v1/verify link. The link lives on the GoTrue
       * origin (cross-origin for Cypress), so resolve its redirect with
       * cy.request first and visit the resulting app URL — the PKCE code
       * verifier cookie in this browser context stays intact.
       */
      visitRecoveryLink(url: string): Chainable<void>
    }
  }
}

Cypress.Commands.add("getByTestId", (testId: string) =>
  cy.get(`[data-testid="${testId}"]`),
)

const logInThroughUi = (email: string, password: string) => {
  cy.visit("/login")
  cy.getByTestId("email-input").type(email)
  cy.getByTestId("password-input").type(password)
  cy.contains("button", "Log In").click()
  cy.location("pathname").should("eq", "/")
  cy.contains("Welcome back, nice to see you again!").should("be.visible")
}

Cypress.Commands.add("loginAs", (email: string, password: string) => {
  cy.session(
    ["user", email],
    () => {
      logInThroughUi(email, password)
    },
    { cacheAcrossSpecs: true },
  )
})

Cypress.Commands.add("loginAsSuperuser", () => {
  cy.loginAs(
    Cypress.env("FIRST_SUPERUSER") as string,
    Cypress.env("FIRST_SUPERUSER_PASSWORD") as string,
  )
})

Cypress.Commands.add("logInUser", (email: string, password: string) => {
  logInThroughUi(email, password)
})

Cypress.Commands.add("logOutUser", () => {
  cy.getByTestId("user-menu").click()
  cy.contains('[role="menuitem"]', /log out/i).click()
  cy.location("pathname").should("eq", "/login")
})

Cypress.Commands.add(
  "signUpNewUser",
  (name: string, email: string, password: string) => {
    cy.visit("/signup")
    cy.getByTestId("full-name-input").type(name)
    cy.getByTestId("email-input").type(email)
    cy.getByTestId("password-input").type(password)
    cy.getByTestId("confirm-password-input").type(password)
    cy.contains("button", "Sign Up").click()
    // Successful Supabase signup signs out and routes to /login.
    cy.location("pathname").should("eq", "/login")
  },
)

// The `private` router is only mounted for local environments.
Cypress.Commands.add("createUserViaApi", (email: string, password: string) => {
  return cy
    .request<UserPublic>({
      method: "POST",
      url: `${Cypress.env("API_URL")}/api/v1/private/users/`,
      body: {
        email,
        password,
        is_verified: true,
        full_name: "Test User",
      },
    })
    .then((response) => response.body)
})

type MailpitAddress = { Address: string; Name: string }
type MailpitMessageSummary = {
  ID: string
  To: MailpitAddress[]
  Subject: string
}

const findLastEmailTo = (
  email: string,
  deadline: number,
): Cypress.Chainable<MailpitMessageSummary> => {
  const mailpitHost = Cypress.env("MAILPIT_HOST") as string
  return cy
    .request<{ messages: MailpitMessageSummary[] }>({
      url: `${mailpitHost}/api/v1/messages`,
      log: false,
    })
    .then((response) => {
      // Messages are returned newest first.
      const message = response.body.messages.find((m) =>
        m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
      )
      if (message) {
        return cy.wrap(message, { log: false })
      }
      if (Date.now() > deadline) {
        throw new Error(`Timeout while waiting for an email to ${email}`)
      }
      return cy
        .wait(200, { log: false })
        .then(() => findLastEmailTo(email, deadline))
    })
}

// Extracts the Supabase recovery link (/auth/v1/verify?...) from the most
// recent email sent to `email`.
Cypress.Commands.add("findRecoveryLink", (email: string) => {
  const mailpitHost = Cypress.env("MAILPIT_HOST") as string
  return findLastEmailTo(email, Date.now() + 10000)
    .then((message) =>
      cy.request<{ HTML: string; Text: string }>({
        url: `${mailpitHost}/api/v1/message/${message.ID}`,
        log: false,
      }),
    )
    .then((response) => {
      const content = `${response.body.Text ?? ""}\n${response.body.HTML ?? ""}`
      const match = content.match(
        /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/,
      )
      if (!match) {
        throw new Error(`No recovery link found in the email to ${email}`)
      }
      // The link may come from the HTML part with encoded ampersands.
      return match[0].replace(/&amp;/g, "&")
    })
})

Cypress.Commands.add("visitRecoveryLink", (url: string) => {
  cy.request({ url, followRedirect: false }).then((response) => {
    const location = response.headers.location
    if (typeof location !== "string") {
      throw new Error(
        `Recovery link did not redirect (status ${response.status})`,
      )
    }
    cy.visit(new URL(location, url).toString())
  })
})
