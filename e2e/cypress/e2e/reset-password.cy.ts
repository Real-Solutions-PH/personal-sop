import { randomEmail, randomPassword } from "../support/random"

it("Password Recovery title is visible", () => {
  cy.visit("/recover-password")

  cy.contains("h1, h2, h3", "Password Recovery").should("be.visible")
})

it("Input is visible, empty and editable", () => {
  cy.visit("/recover-password")

  cy.getByTestId("email-input")
    .should("be.visible")
    .should("have.value", "")
    .should("be.enabled")
})

it("Continue button is visible", () => {
  cy.visit("/recover-password")

  cy.contains("button", "Continue").should("be.visible")
})

it("User can reset password successfully using the link", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()
  const newPassword = randomPassword()

  // Sign up a new user
  cy.signUpNewUser(fullName, email, password)

  cy.visit("/recover-password")
  cy.getByTestId("email-input").type(email)

  cy.contains("button", "Continue").click()
  cy.contains("Password recovery email sent successfully").should("be.visible")

  // Supabase (GoTrue) sends the recovery email through the local Mailpit
  // instance; the /auth/v1/verify link redirects to /reset-password?code=...
  cy.findRecoveryLink(email).then((url) => {
    // Set the new password and confirm it (the PKCE code verifier lives in
    // this browser context — the link must be opened in the same one).
    cy.visitRecoveryLink(url)
    cy.location("pathname").should("match", /reset-password/)

    cy.getByTestId("new-password-input").type(newPassword)
    cy.getByTestId("confirm-password-input").type(newPassword)
    cy.contains("button", "Reset Password").click()
    cy.contains("Password updated successfully").should("be.visible")

    // Check if the user is able to login with the new password
    cy.logInUser(email, newPassword)
  })
})

it("Expired or invalid reset link", () => {
  // No valid recovery code: the exchange fails and the form is disabled.
  cy.visit("/reset-password?code=invalid-code")

  cy.contains("Invalid or expired reset link").should("be.visible")
  cy.contains("button", "Reset Password").should("be.disabled")
})

it("Weak new password validation", () => {
  const fullName = "Test User"
  const email = randomEmail()
  const password = randomPassword()
  const weakPassword = "123"

  // Sign up a new user
  cy.signUpNewUser(fullName, email, password)

  cy.visit("/recover-password")
  cy.getByTestId("email-input").type(email)
  cy.contains("button", "Continue").click()
  cy.contains("Password recovery email sent successfully").should("be.visible")

  cy.findRecoveryLink(email).then((url) => {
    // Set a weak new password
    cy.visitRecoveryLink(url)
    cy.location("pathname").should("match", /reset-password/)
    cy.getByTestId("new-password-input").type(weakPassword)
    cy.getByTestId("confirm-password-input").type(weakPassword)
    cy.contains("button", "Reset Password").click()

    cy.contains("Password must be at least 8 characters").should("be.visible")
  })
})
