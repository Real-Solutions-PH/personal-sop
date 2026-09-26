import { randomPassword } from "../support/random"

const firstSuperuser = Cypress.env("FIRST_SUPERUSER") as string
const firstSuperuserPassword = Cypress.env("FIRST_SUPERUSER_PASSWORD") as string

const fillForm = (email: string, password: string) => {
  cy.getByTestId("email-input").type(email)
  cy.getByTestId("password-input").type(password)
}

const verifyInput = (testId: string) => {
  cy.getByTestId(testId)
    .should("be.visible")
    .should("have.value", "")
    .should("be.enabled")
}

it("Inputs are visible, empty and editable", () => {
  cy.visit("/login")

  verifyInput("email-input")
  verifyInput("password-input")
})

it("Log In button is visible", () => {
  cy.visit("/login")

  cy.contains("button", "Log In").should("be.visible")
})

it("Forgot Password link is visible", () => {
  cy.visit("/login")

  cy.contains("a", "Forgot your password?").should("be.visible")
})

it("Log in with valid email and password ", () => {
  cy.visit("/login")

  fillForm(firstSuperuser, firstSuperuserPassword)
  cy.contains("button", "Log In").click()

  cy.location("pathname").should("eq", "/")

  cy.contains("Welcome back, nice to see you again!").should("be.visible")
})

it("Log in with invalid email", () => {
  cy.visit("/login")

  fillForm("invalidemail", firstSuperuserPassword)
  cy.contains("button", "Log In").click()

  cy.contains("Invalid email address").should("be.visible")
})

it("Log in with invalid password", () => {
  const password = randomPassword()

  cy.visit("/login")
  fillForm(firstSuperuser, password)
  cy.contains("button", "Log In").click()

  // GoTrue's error copy for a failed password sign-in.
  cy.contains("Invalid login credentials").should("be.visible")
})

it("Successful log out", () => {
  cy.visit("/login")

  fillForm(firstSuperuser, firstSuperuserPassword)
  cy.contains("button", "Log In").click()

  cy.location("pathname").should("eq", "/")

  cy.contains("Welcome back, nice to see you again!").should("be.visible")

  cy.getByTestId("user-menu").click()
  cy.contains('[role="menuitem"]', /log out/i).click()
  cy.location("pathname").should("eq", "/login")
})

it("Logged-out user cannot access protected routes", () => {
  cy.visit("/login")

  fillForm(firstSuperuser, firstSuperuserPassword)
  cy.contains("button", "Log In").click()

  cy.location("pathname").should("eq", "/")

  cy.contains("Welcome back, nice to see you again!").should("be.visible")

  cy.getByTestId("user-menu").click()
  cy.contains('[role="menuitem"]', /log out/i).click()
  cy.location("pathname").should("eq", "/login")

  cy.visit("/settings")
  cy.location("pathname").should("eq", "/login")
})

// Dropped: "Redirects to /login when token is wrong". Auth moved from a
// localStorage/app-cookie token to Supabase-managed sb-*-auth-token cookies;
// the middleware revalidates them via supabase.auth.getUser(), and
// the unauthenticated-redirect path is already covered by
// "Logged-out user cannot access protected routes" above.
