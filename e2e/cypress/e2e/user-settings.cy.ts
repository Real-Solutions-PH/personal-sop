import { randomEmail, randomPassword } from "../support/random"

const firstSuperuser = Cypress.env("FIRST_SUPERUSER") as string
const firstSuperuserPassword = Cypress.env("FIRST_SUPERUSER_PASSWORD") as string

const tabs = ["My profile", "Password", "Danger zone"]

it("My profile tab is active by default", () => {
  cy.loginAsSuperuser()
  cy.visit("/settings")
  cy.contains('[role="tab"]', "My profile").should(
    "have.attr",
    "aria-selected",
    "true",
  )
})

it("All tabs are visible", () => {
  cy.loginAsSuperuser()
  cy.visit("/settings")
  for (const tab of tabs) {
    cy.contains('[role="tab"]', tab).should("be.visible")
  }
})

describe("Edit user profile", () => {
  const password = randomPassword()
  let email: string

  before(() => {
    email = randomEmail()
    cy.createUserViaApi(email, password)
  })

  beforeEach(() => {
    cy.loginAs(email, password)
    cy.visit("/settings")
    cy.contains('[role="tab"]', "My profile").click()
  })

  it("Edit user name with a valid name", () => {
    const updatedName = "Test User 2"

    cy.contains("button", "Edit").click()
    cy.findByLabelText("Full name").clear()
    cy.findByLabelText("Full name").type(updatedName)
    cy.contains("button", "Save").click()

    cy.contains("User updated successfully").should("be.visible")
    cy.get("form")
      .contains(new RegExp(`^${updatedName}$`))
      .should("be.visible")
  })

  it("Edit user email with an invalid email shows error", () => {
    cy.contains("button", "Edit").click()
    cy.findByLabelText("Email").clear()
    cy.findByLabelText("Email").blur()

    cy.contains("Invalid email address").should("be.visible")
  })
})

describe("Edit user email", () => {
  // Self-service email change is intentionally refused (400). The old path
  // pushed the new address straight through the GoTrue admin API with
  // email_confirm=true, confirming an address the user never proved they own
  // — an account-takeover primitive. Until a proper user-initiated,
  // double-confirmation email change is wired, the API rejects it; superusers
  // can still change a user's email via the admin flow.
  it("Self-service email change is refused and leaves the address unchanged", () => {
    const email = randomEmail()
    const password = randomPassword()
    const updatedEmail = randomEmail()

    cy.createUserViaApi(email, password)
    cy.logInUser(email, password)
    cy.visit("/settings")
    cy.contains('[role="tab"]', "My profile").click()

    cy.contains("button", "Edit").click()
    cy.findByLabelText("Email").clear()
    cy.findByLabelText("Email").type(updatedEmail)
    cy.contains("button", "Save").click()

    cy.contains("Self-service email changes are not supported").should(
      "be.visible",
    )

    // The address is left untouched — cancel out and the original stands.
    cy.contains("button", "Cancel").first().click()
    cy.get("form")
      .contains(new RegExp(`^${email}$`))
      .should("be.visible")
  })
})

describe("Cancel edit actions", () => {
  it("Cancel edit action restores original name", () => {
    const email = randomEmail()
    const password = randomPassword()

    cy.createUserViaApi(email, password).then((user) => {
      cy.logInUser(email, password)
      cy.visit("/settings")
      cy.contains('[role="tab"]', "My profile").click()
      cy.contains("button", "Edit").click()
      cy.findByLabelText("Full name").clear()
      cy.findByLabelText("Full name").type("Test User")
      cy.contains("button", "Cancel").first().click()

      cy.get("form")
        .contains(new RegExp(`^${user.full_name as string}$`))
        .should("be.visible")
    })
  })

  it("Cancel edit action restores original email", () => {
    const email = randomEmail()
    const password = randomPassword()
    cy.createUserViaApi(email, password)

    cy.logInUser(email, password)
    cy.visit("/settings")
    cy.contains('[role="tab"]', "My profile").click()
    cy.contains("button", "Edit").click()
    cy.findByLabelText("Email").clear()
    cy.findByLabelText("Email").type(randomEmail())
    cy.contains("button", "Cancel").first().click()

    cy.get("form")
      .contains(new RegExp(`^${email}$`))
      .should("be.visible")
  })
})

describe("Change password", () => {
  it("Update password successfully", () => {
    const email = randomEmail()
    const password = randomPassword()
    const newPassword = randomPassword()

    cy.createUserViaApi(email, password)
    cy.logInUser(email, password)

    cy.visit("/settings")
    cy.contains('[role="tab"]', "Password").click()
    cy.getByTestId("current-password-input").type(password)
    cy.getByTestId("new-password-input").type(newPassword)
    cy.getByTestId("confirm-password-input").type(newPassword)
    cy.contains("button", "Update Password").click()

    cy.contains("Password updated successfully").should("be.visible")

    cy.logOutUser()
    cy.logInUser(email, newPassword)
  })
})

describe("Change password validation", () => {
  const password = randomPassword()
  let email: string

  before(() => {
    email = randomEmail()
    cy.createUserViaApi(email, password)
  })

  beforeEach(() => {
    cy.loginAs(email, password)
    cy.visit("/settings")
    cy.contains('[role="tab"]', "Password").click()
  })

  it("Update password with weak passwords", () => {
    const weakPassword = "weak"

    cy.getByTestId("current-password-input").type(password)
    cy.getByTestId("new-password-input").type(weakPassword)
    cy.getByTestId("confirm-password-input").type(weakPassword)
    cy.contains("button", "Update Password").click()

    cy.contains("Password must be at least 8 characters").should("be.visible")
  })

  it("New password and confirmation password do not match", () => {
    cy.getByTestId("current-password-input").type(password)
    cy.getByTestId("new-password-input").type(randomPassword())
    cy.getByTestId("confirm-password-input").type(randomPassword())
    cy.contains("button", "Update Password").click()

    cy.contains("The passwords don't match").should("be.visible")
  })

  it("Current password and new password are the same", () => {
    cy.getByTestId("current-password-input").type(password)
    cy.getByTestId("new-password-input").type(password)
    cy.getByTestId("confirm-password-input").type(password)
    cy.contains("button", "Update Password").click()

    cy.contains("New password cannot be the same as the current one").should(
      "be.visible",
    )
  })
})

it("Appearance button is visible in sidebar", () => {
  cy.loginAsSuperuser()
  cy.visit("/settings")
  cy.getByTestId("theme-button").should("be.visible")
})

it("User can switch between theme modes", () => {
  cy.loginAsSuperuser()
  cy.visit("/settings")

  cy.getByTestId("theme-button").click()
  cy.getByTestId("dark-mode").click()
  cy.get("html").should("have.class", "dark")

  cy.getByTestId("dark-mode").should("not.exist")

  cy.getByTestId("theme-button").click()
  cy.getByTestId("light-mode").click()
  cy.get("html").should("have.class", "light")
})

it("Selected mode is preserved across sessions", () => {
  // Plain UI login (not cy.session): this test logs the superuser out at
  // the end, and theme persistence must survive a real logout/login cycle.
  cy.logInUser(firstSuperuser, firstSuperuserPassword)
  cy.visit("/settings")

  // Start from a known light state regardless of the machine default …
  cy.getByTestId("theme-button").click()
  cy.getByTestId("light-mode").click()
  cy.get("html").should("have.class", "light")
  // Let the menu fully close before reopening — clicking through the exit
  // animation makes cy.click() race the re-render.
  cy.getByTestId("light-mode").should("not.exist")

  // … then flip to dark before the logout/login round-trip.
  cy.getByTestId("theme-button").click()
  cy.getByTestId("dark-mode").click()
  cy.get("html").should("have.class", "dark")
  cy.getByTestId("dark-mode").should("not.exist")

  cy.logOutUser()
  cy.logInUser(firstSuperuser, firstSuperuserPassword)

  cy.get("html").should("have.class", "dark")
})
