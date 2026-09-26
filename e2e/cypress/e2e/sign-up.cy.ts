import { randomEmail, randomPassword } from "../support/random"

// cy.type("") throws on an empty string — clear first and only type when
// there is something to type.
const fillInput = (testId: string, value: string) => {
  cy.getByTestId(testId).clear()
  if (value) {
    cy.getByTestId(testId).type(value)
  }
}

const fillForm = (
  fullName: string,
  email: string,
  password: string,
  confirmPassword: string,
) => {
  fillInput("full-name-input", fullName)
  fillInput("email-input", email)
  fillInput("password-input", password)
  fillInput("confirm-password-input", confirmPassword)
}

const verifyInput = (testId: string) => {
  cy.getByTestId(testId)
    .should("be.visible")
    .should("have.value", "")
    .should("be.enabled")
}

it("Inputs are visible, empty and editable", () => {
  cy.visit("/signup")

  verifyInput("full-name-input")
  verifyInput("email-input")
  verifyInput("password-input")
  verifyInput("confirm-password-input")
})

it("Sign Up button is visible", () => {
  cy.visit("/signup")

  cy.contains("button", "Sign Up").should("be.visible")
})

it("Log In link is visible", () => {
  cy.visit("/signup")

  // The link copy is "Log in" — cy.contains string matching is
  // case-sensitive, so match with a case-insensitive regex.
  cy.contains("a", /log in/i).should("be.visible")
})

it("Sign up with valid name, email, and password", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  cy.visit("/signup")
  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()
})

it("Sign up with invalid email", () => {
  cy.visit("/signup")

  fillForm("Cypress Test", "invalid-email", "changethis", "changethis")
  cy.contains("button", "Sign Up").click()

  cy.contains("Invalid email address").should("be.visible")
})

it("Sign up with existing email", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()

  // A *confirmed* account must already exist for GoTrue to reject the signup.
  // The local stack now runs with email confirmations enabled, so re-signing
  // up an unconfirmed address is obfuscated (anti-enumeration) rather than
  // erroring — seed a verified user via the API to get a real duplicate.
  cy.createUserViaApi(email, password)

  cy.visit("/signup")
  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()

  // GoTrue's error copy for a duplicate signup against a confirmed address.
  cy.contains("User already registered").should("be.visible")
})

it("Sign up with weak password", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = "weak"

  cy.visit("/signup")

  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()

  cy.contains("Password must be at least 8 characters").should("be.visible")
})

it("Sign up with mismatched passwords", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()
  const password2 = randomPassword()

  cy.visit("/signup")

  fillForm(fullName, email, password, password2)
  cy.contains("button", "Sign Up").click()

  cy.contains("The passwords don't match").should("be.visible")
})

it("Sign up with missing full name", () => {
  const fullName = ""
  const email = randomEmail()
  const password = randomPassword()

  cy.visit("/signup")

  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()

  cy.contains("Full Name is required").should("be.visible")
})

it("Sign up with missing email", () => {
  const fullName = "Test User"
  const email = ""
  const password = randomPassword()

  cy.visit("/signup")

  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()

  cy.contains("Invalid email address").should("be.visible")
})

it("Sign up with missing password", () => {
  const fullName = ""
  const email = randomEmail()
  const password = ""

  cy.visit("/signup")

  fillForm(fullName, email, password, password)
  cy.contains("button", "Sign Up").click()

  cy.contains("Password is required").should("be.visible")
})
