// Account: sign-in reaches the API (the user row is provisioned in Postgres
// with its default role), sign-out clears the device.

describe("live account", () => {
  it("signs in, provisions the user server-side, and signs out cleanly", () => {
    cy.newLiveUser("auth").then((user) => {
      cy.signInLive(user)
      cy.findByText(/to target/i).should("exist")
      // The first authenticated request provisions the mirror row + role.
      cy.eventuallyRows(
        `select u.email, r.name as role from "user" u
           join user_role ur on ur.user_id = u.id
           join role r on r.id = ur.role_id
          where u.id = $1`,
        [user.id],
      ).then((rows) => {
        expect(rows[0]).to.include({ email: user.email, role: "user" })
      })
      cy.liveApi<{ profile: { timezone: string } }>(
        user,
        "GET",
        "/profile",
      ).then((me) => {
        expect(me.profile.timezone).to.eq("Asia/Manila")
      })

      cy.visit("/me")
      cy.findByText("Sign out").scrollIntoView().click()
      cy.location("pathname").should("eq", "/welcome")
      // Sign-out pushes anything queued first, then clears the device.
      cy.window()
        .its("localStorage")
        .invoke("getItem", "sop-live:owner")
        .should("eq", null)
      cy.window()
        .its("localStorage")
        .invoke("getItem", "sop-live:outbox")
        .should("eq", null)
    })
  })

  it("refuses a wrong password without signing in", () => {
    cy.newLiveUser("authbad").then((user) => {
      cy.visit("/welcome")
      cy.findByRole("button", { name: "I already have an account" }).click()
      cy.findByRole("textbox", { name: "Email" }).clear().type(user.email)
      cy.findByLabelText("Password").type("not-the-password")
      cy.findByRole("button", { name: "Sign in" }).click()
      cy.findByText("Incorrect email or password").should("exist")
      cy.location("pathname").should("eq", "/login")
    })
  })
})
