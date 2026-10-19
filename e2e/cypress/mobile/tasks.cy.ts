// Tasks: what the screens do lands in the API and in Postgres.

describe("tasks (live)", () => {
  it("captures tasks, completes one, deletes one — all reach the server", () => {
    cy.newLiveUser("tasks").then((user) => {
      cy.signInLive(user)
      cy.visit("/tasks/capture")
      cy.findByRole("textbox", { name: "Capture text" })
        .clear()
        .type("Pay electric bill, call dentist")
      cy.findByRole("button", { name: "Send" }).click()
      cy.findByText(/saved 2 tasks/i).should("exist")

      cy.eventuallyRows(
        "select id, title, status from task where owner_id = $1 and deleted_at is null order by title",
        [user.id],
        2,
      ).then((rows) => {
        expect(rows.map((r) => r.title)).to.deep.eq([
          "Call dentist",
          "Pay electric bill",
        ])
        const [dentist, bill] = rows as { id: string }[]
        cy.eventuallyApi<{ data: { title: string }[] }>(
          user,
          "/tasks/",
          (b) => b.data.length === 2,
        )

        // Complete one from its detail screen: a domain action on the server.
        cy.visit(`/tasks/task/${dentist.id}`)
        cy.findByRole("button", { name: "Complete" }).click()
        cy.eventuallyRows(
          "select status, completed_at from task where id = $1 and status = 'done' and completed_at is not null",
          [dentist.id],
        )
        cy.eventuallyRows(
          "select type from task_event where task_id = $1 and type = 'completed'",
          [dentist.id],
        )

        // Delete the other: a tombstone, so other devices drop it too.
        cy.visit(`/tasks/task/${bill.id}`)
        cy.findByRole("button", { name: "Delete" }).click()
        cy.eventuallyRows(
          "select status from task where id = $1 and status = 'deleted' and deleted_at is not null",
          [bill.id],
        )
        cy.eventuallyApi<{ data: { id: string }[] }>(
          user,
          "/tasks/",
          (b) => !b.data.some((t) => t.id === bill.id),
        )
      })
    })
  })
})
