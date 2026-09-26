import { randomEmail, randomPassword } from "../support/random"

const firstSuperuser = Cypress.env("FIRST_SUPERUSER") as string
const firstSuperuserPassword = Cypress.env("FIRST_SUPERUSER_PASSWORD") as string

it("Admin page is accessible and shows correct title", () => {
  cy.loginAsSuperuser()
  cy.visit("/admin")
  cy.contains("h1, h2, h3", "Users").should("be.visible")
  cy.contains("Manage user accounts and permissions").should("be.visible")
})

it("Add User button is visible", () => {
  cy.loginAsSuperuser()
  cy.visit("/admin")
  cy.contains("button", "Add User").should("be.visible")
})

describe("Admin user management", () => {
  beforeEach(() => {
    cy.loginAsSuperuser()
    cy.visit("/admin")
  })

  it("Create a new user successfully", () => {
    const email = randomEmail()
    const password = randomPassword()
    const fullName = "Test User Admin"

    cy.contains("button", "Add User").click()

    cy.findByPlaceholderText("Email").type(email)
    cy.findByPlaceholderText("Full name").type(fullName)
    cy.findAllByPlaceholderText("Password").first().type(password)
    cy.findAllByPlaceholderText("Password").last().type(password)

    cy.contains("button", "Save").click()

    cy.contains("User created successfully").should("be.visible")

    cy.get('[role="dialog"]').should("not.exist")

    cy.contains("tr", email).should("be.visible")
  })

  it("Create a superuser", () => {
    const email = randomEmail()
    const password = randomPassword()

    cy.contains("button", "Add User").click()

    cy.findByPlaceholderText("Email").type(email)
    cy.findAllByPlaceholderText("Password").first().type(password)
    cy.findAllByPlaceholderText("Password").last().type(password)
    cy.contains("label", "Is superuser?").click()
    cy.contains("label", "Is active?").click()

    cy.contains("button", "Save").click()

    cy.contains("User created successfully").should("be.visible")

    cy.get('[role="dialog"]').should("not.exist")

    cy.contains("tr", email).contains("Superuser").should("be.visible")
  })

  it("Edit a user successfully", () => {
    const email = randomEmail()
    const password = randomPassword()
    const originalName = "Original Name"
    const updatedName = "Updated Name"

    cy.contains("button", "Add User").click()
    cy.findByPlaceholderText("Email").type(email)
    cy.findByPlaceholderText("Full name").type(originalName)
    cy.findAllByPlaceholderText("Password").first().type(password)
    cy.findAllByPlaceholderText("Password").last().type(password)
    cy.contains("button", "Save").click()

    cy.contains("User created successfully").should("be.visible")
    cy.get('[role="dialog"]').should("not.exist")

    cy.contains("tr", email).find("button").click()

    cy.contains('[role="menuitem"]', "Edit User").click()

    cy.findByPlaceholderText("Full name").clear()
    cy.findByPlaceholderText("Full name").type(updatedName)
    cy.contains("button", "Save").click()

    cy.contains("User updated successfully").should("be.visible")
    cy.contains(updatedName).should("be.visible")
  })

  it("Delete a user successfully", () => {
    const email = randomEmail()
    const password = randomPassword()

    cy.contains("button", "Add User").click()
    cy.findByPlaceholderText("Email").type(email)
    cy.findAllByPlaceholderText("Password").first().type(password)
    cy.findAllByPlaceholderText("Password").last().type(password)
    cy.contains("button", "Save").click()

    cy.contains("User created successfully").should("be.visible")

    cy.get('[role="dialog"]').should("not.exist")

    cy.contains("tr", email).find("button").click()

    cy.contains('[role="menuitem"]', "Delete User").click()

    cy.contains("button", "Delete").click()

    cy.contains("The user was deleted successfully").should("be.visible")

    cy.contains("tr", email).should("not.exist")
  })

  it("Cancel user creation", () => {
    cy.contains("button", "Add User").click()
    cy.findByPlaceholderText("Email").type("test@example.com")

    cy.contains("button", "Cancel").click()

    cy.get('[role="dialog"]').should("not.exist")
  })

  it("Email is required and must be valid", () => {
    cy.contains("button", "Add User").click()

    cy.findByPlaceholderText("Email").type("invalid-email")
    cy.findByPlaceholderText("Email").blur()

    cy.contains("Invalid email address").should("be.visible")
  })

  it("Password must be at least 8 characters", () => {
    cy.contains("button", "Add User").click()

    cy.findByPlaceholderText("Email").type(randomEmail())
    cy.findAllByPlaceholderText("Password").first().type("short")
    cy.findAllByPlaceholderText("Password").last().type("short")
    cy.contains("button", "Save").click()

    cy.contains("Password must be at least 8 characters").should("be.visible")
  })

  it("Passwords must match", () => {
    cy.contains("button", "Add User").click()

    cy.findByPlaceholderText("Email").type(randomEmail())
    cy.findAllByPlaceholderText("Password").first().type(randomPassword())
    cy.findAllByPlaceholderText("Password").last().type("different12345")
    cy.findAllByPlaceholderText("Password").last().blur()

    cy.contains("The passwords don't match").should("be.visible")
  })
})

describe("Admin page access control", () => {
  it("Non-superuser is redirected home, stays signed in, never calls readUsers", () => {
    const email = randomEmail()
    const password = randomPassword()

    cy.createUserViaApi(email, password)
    cy.logInUser(email, password)

    // The admin table's readUsers is superuser-only; it must not fire before
    // the superuser guard resolves (a stray 403 previously signed the user out).
    let readUsersCalled = false
    cy.intercept("GET", "**/api/v1/users/*", (req) => {
      // /users/me is the current-user probe and is expected; the list is not.
      if (!req.url.includes("/users/me")) readUsersCalled = true
    }).as("usersList")

    cy.visit("/admin")

    // Redirected to "/" (home) — NOT signed out to "/login".
    cy.location("pathname").should("eq", "/")
    cy.contains("h1, h2, h3", "Users").should("not.exist")
    cy.then(() => {
      expect(readUsersCalled, "readUsers must not be called for a normal user")
        .to.be.false
    })
  })

  it("Superuser can access admin page", () => {
    cy.logInUser(firstSuperuser, firstSuperuserPassword)

    cy.visit("/admin")

    cy.contains("h1, h2, h3", "Users").should("be.visible")
  })
})
