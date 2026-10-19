// Task lists: create / edit / reorder / archive / delete (moving or deleting
// the tasks), shopping lists and the smart views, proven in the API and in
// Postgres. Inventory: see tasks.cy.ts.
import {
  api,
  pushed,
  rows,
  type ServerList,
  type ServerTask,
  seedList,
  seedTask,
  settled,
  signIn,
  tick,
  titleButton,
  trackSync,
  visitAndWait,
} from "./tasks-helpers"

Cypress.config("responseTimeout", 90000)

const list = (owner: string, name: string) =>
  rows(
    "select * from task_list where owner_id = $1 and name = $2 and deleted_at is null",
    [owner, name],
  ).its(0)

describe("task lists (live)", () => {
  beforeEach(trackSync)

  it("create, edit, reorder, archive and unarchive lists", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      cy.visit("/tasks/lists")
      cy.findByText("No lists yet").should("exist")

      // New standard list with a colour and an icon.
      cy.findAllByRole("button", { name: "New list" }).first().click()
      cy.findByRole("textbox", { name: "List name" }).type("Side hustle")
      cy.findByRole("button", { name: "Colour fin" }).click()
      cy.findByRole("button", { name: "Icon laptop" }).click()
      cy.findByRole("button", { name: "Create list" }).click()
      list(user.id, "Side hustle").then((l) => {
        expect(l.kind).to.eq("standard")
        expect(l.color).to.eq("fin")
        expect(l.icon).to.eq("laptop")
      })

      // New shopping list.
      settled()
      cy.findAllByRole("button", { name: "New list" }).first().click()
      cy.findByRole("textbox", { name: "List name" }).type("Groceries")
      cy.findByRole("button", { name: "Icon cart" }).click()
      cy.findByRole("switch", { name: "Shopping mode" }).click()
      cy.findByRole("button", { name: "Create list" }).click()
      list(user.id, "Groceries").its("kind").should("eq", "shopping")
      api<{ data: { name: string }[] }>(user, "/tasks/lists", (b) =>
        ["Side hustle", "Groceries"].every((n) =>
          b.data.some((x) => x.name === n),
        ),
      )

      // Reorder: Groceries first.
      settled()
      cy.findByRole("button", { name: "Move Groceries up" }).click()
      rows(
        `select name from task_list where owner_id = $1 and name = 'Groceries'
           and sort_order < (select sort_order from task_list where owner_id = $1 and name = 'Side hustle')`,
        [user.id],
      )

      // Edit: rename and recolour.
      settled()
      cy.findByRole("button", { name: "Edit Side hustle" }).click()
      cy.findByRole("textbox", { name: "List name" }).clear().type("Side gig")
      cy.findByRole("button", { name: "Colour hab" }).click()
      cy.findByRole("button", { name: "Save" }).click()
      list(user.id, "Side gig").its("color").should("eq", "hab")

      // Archive, then unarchive from the Archived section.
      settled()
      cy.findByRole("button", { name: "Edit Side gig" }).click()
      cy.findByRole("button", { name: "Archive" }).click()
      rows(
        "select id from task_list where owner_id = $1 and name = 'Side gig' and archived_at is not null",
        [user.id],
      )
      cy.findByText("Archived").should("exist")
      settled()
      cy.findByRole("button", { name: "Unarchive" }).click()
      rows(
        "select id from task_list where owner_id = $1 and name = 'Side gig' and archived_at is null",
        [user.id],
      )
    })
  })

  it("delete a list, moving its open tasks to the Inbox", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedList(user, { name: "Work" }).then((l: ServerList) =>
        seedTask(user, { title: "Send invoice", list_id: l.id }).then(
          (a: ServerTask) =>
            seedTask(user, { title: "Review deck", list_id: l.id }).then(
              (b: ServerTask) => {
                visitAndWait("/tasks/lists", "2 open")
                cy.findByRole("button", { name: "Edit Work" }).click()
                cy.findByRole("button", { name: "Delete" }).click()
                cy.findByText(/It has 2 open tasks/).should("exist")
                cy.findByRole("button", { name: "Move to Inbox" }).click()
                rows(
                  "select id from task_list where id = $1 and deleted_at is not null",
                  [l.id],
                )
                for (const t of [a, b])
                  rows(
                    "select id from task where id = $1 and list_id is null and status = 'open' and deleted_at is null",
                    [t.id],
                  )
                api<{ data: { id: string }[] }>(
                  user,
                  "/tasks/?inbox=true",
                  (body) =>
                    [a.id, b.id].every((id) =>
                      body.data.some((t) => t.id === id),
                    ),
                )
              },
            ),
        ),
      )
    })
  })

  it("delete a list with its tasks, from the list page's Edit list", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedList(user, { name: "Temp" }).then((l: ServerList) =>
        seedTask(user, { title: "Throwaway", list_id: l.id }).then(
          (t: ServerTask) => {
            visitAndWait(`/tasks/list/${l.id}`, "Throwaway")
            cy.findByRole("button", { name: "Edit list" }).click()
            cy.findByRole("button", { name: "Delete" }).click()
            cy.findByRole("button", { name: "Delete tasks" }).click()
            rows(
              "select id from task_list where id = $1 and deleted_at is not null",
              [l.id],
            )
            rows(
              "select id from task where id = $1 and status = 'deleted' and deleted_at is not null",
              [t.id],
            )
            api<{ data: { id: string }[] }>(user, "/tasks/deleted", (b) =>
              b.data.some((x) => x.id === t.id),
            )
          },
        ),
      )
    })
  })

  it("shopping list: add items, check them, clear checked, undo", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedList(user, {
        name: "Groceries",
        kind: "shopping",
        icon: "cart",
      }).then((l: ServerList) => {
        visitAndWait(`/tasks/list/${l.id}`, "Nothing here")
        cy.findByRole("textbox", { name: "Add item" }).type("Milk{enter}")
        cy.findByRole("textbox", { name: "Add item" }).type("Eggs{enter}")
        rows(
          "select id from task where owner_id = $1 and list_id = $2 and due_date is null",
          [user.id, l.id],
          2,
        )

        tick("Milk")
        rows(
          "select id from task where owner_id = $1 and title = 'Milk' and status = 'done'",
          [user.id],
        )
        cy.findByText("In cart · 1").should("exist")
        settled()

        // Clear checked, then Undo while its toast is still up (6 s): wait
        // only until the clear has been SENT, then prove both on the server.
        cy.findByText("Clear checked").click()
        cy.findByText("In cart · 1").should("not.exist")
        pushed(
          (op) =>
            op.kind === "upsert" && op.name === "task" && !!op.data?.cleared_at,
        )
        cy.findByRole("button", { name: "Undo" }).click()
        rows(
          `select r.op_id from sync_op_receipt r where r.owner_id = $1
             and r.entity = 'task' and r.status = 'applied'
             and r.result->'row'->>'title' = 'Milk'
             and r.result->'row'->>'cleared_at' is not null`,
          [user.id],
        )
        rows(
          "select id from task where owner_id = $1 and title = 'Milk' and status = 'done' and cleared_at is null",
          [user.id],
        )
        // The clear landed before the undo did.
        rows(
          `select r.op_id from sync_op_receipt r where r.owner_id = $1
             and r.entity = 'task' and r.result->'row'->>'title' = 'Milk'
             and r.result->'row'->>'cleared_at' is null
             and r.applied_at > (select min(applied_at) from sync_op_receipt
               where owner_id = $1 and result->'row'->>'cleared_at' is not null)`,
          [user.id],
        )
        cy.findByText("In cart · 1").should("exist")
        titleButton("Eggs").should("exist")
      })
    })
  })

  it("smart views: Inbox and Starred pages, and the Plan Lists tab", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedList(user, { name: "Home" }).then(() =>
        seedTask(user, { title: "Shining star", starred: true }).then(() =>
          seedTask(user, { title: "Loose end" }).then(() => {
            visitAndWait("/tasks/list/starred", "Shining star")
            titleButton("Loose end").should("not.exist")
            cy.findByRole("textbox", { name: "Add task" }).type(
              "Another star{enter}",
            )
            rows(
              "select id from task where owner_id = $1 and title = 'Another star' and starred and list_id is null",
              [user.id],
            )

            visitAndWait("/tasks/list/inbox", "Loose end")
            titleButton("Shining star").should("exist")

            visitAndWait("/plan", "Plan")
            cy.findByRole("tab", { name: "Lists" }).click()
            cy.findByText("Home").should("exist")
            cy.findByText("Starred").click()
            cy.location("pathname").should("eq", "/tasks/list/starred")
          }),
        ),
      )
    })
  })
})
