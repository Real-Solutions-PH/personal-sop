import {
  randomEmail,
  randomItemDescription,
  randomItemTitle,
  randomPassword,
} from "../support/random"

it("Items page is accessible and shows correct title", () => {
  cy.loginAsSuperuser()
  cy.visit("/items")
  // Exact-match the heading so "Items" doesn't collide with other copy.
  cy.get("h1, h2, h3")
    .contains(/^Items$/)
    .should("be.visible")
  cy.contains("Create and manage your items").should("be.visible")
})

it("Add Item button is visible", () => {
  cy.loginAsSuperuser()
  cy.visit("/items")
  cy.contains("button", "Add Item").should("be.visible")
})

describe("Items management", () => {
  const password = randomPassword()
  let email: string

  before(() => {
    email = randomEmail()
    cy.createUserViaApi(email, password)
  })

  beforeEach(() => {
    cy.loginAs(email, password)
    cy.visit("/items")
  })

  it("Create a new item successfully", () => {
    const title = randomItemTitle()
    const description = randomItemDescription()

    cy.contains("button", "Add Item").click()
    cy.findByLabelText(/^Title/).type(title)
    cy.findByLabelText("Description").type(description)
    cy.contains("button", "Save").click()

    cy.contains("Item created successfully").should("be.visible")
    cy.contains(title).should("be.visible")
  })

  it("Create item with only required fields", () => {
    const title = randomItemTitle()

    cy.contains("button", "Add Item").click()
    cy.findByLabelText(/^Title/).type(title)
    cy.contains("button", "Save").click()

    cy.contains("Item created successfully").should("be.visible")
    cy.contains(title).should("be.visible")
  })

  it("Cancel item creation", () => {
    cy.contains("button", "Add Item").click()
    cy.findByLabelText(/^Title/).type("Test Item")
    cy.contains("button", "Cancel").click()

    cy.get('[role="dialog"]').should("not.exist")
  })

  it("Title is required", () => {
    cy.contains("button", "Add Item").click()
    cy.findByLabelText(/^Title/).clear()
    cy.findByLabelText(/^Title/).blur()

    cy.contains("Title is required").should("be.visible")
  })

  describe("Edit and Delete", () => {
    let itemTitle: string

    beforeEach(() => {
      itemTitle = randomItemTitle()

      cy.contains("button", "Add Item").click()
      cy.findByLabelText(/^Title/).type(itemTitle)
      cy.contains("button", "Save").click()
      cy.contains("Item created successfully").should("be.visible")
      cy.get('[role="dialog"]').should("not.exist")
    })

    it("Edit an item successfully", () => {
      cy.contains("tr", itemTitle).find("button").last().click()
      cy.contains('[role="menuitem"]', "Edit Item").click()

      const updatedTitle = randomItemTitle()
      cy.findByLabelText(/^Title/).clear()
      cy.findByLabelText(/^Title/).type(updatedTitle)
      cy.contains("button", "Save").click()

      cy.contains("Item updated successfully").should("be.visible")
      cy.contains(updatedTitle).should("be.visible")
    })

    it("Delete an item successfully", () => {
      cy.contains("tr", itemTitle).find("button").last().click()
      cy.contains('[role="menuitem"]', "Delete Item").click()

      cy.contains("button", "Delete").click()

      cy.contains("The item was deleted successfully").should("be.visible")
      cy.contains(itemTitle).should("not.exist")
    })
  })
})

describe("Items empty state", () => {
  it("Shows empty state message when no items exist", () => {
    const email = randomEmail()
    const password = randomPassword()
    cy.createUserViaApi(email, password)
    cy.logInUser(email, password)

    cy.visit("/items")

    cy.contains("You don't have any items yet").should("be.visible")
    cy.contains("Add a new item to get started").should("be.visible")
  })
})
