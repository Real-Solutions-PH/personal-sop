// Tasks lifecycle: complete / uncomplete, recurrence, reschedule, snooze,
// overdue triage, delete / restore and reorder, driven from the real rows
// and proven in the API and Postgres. Inventory: see tasks.cy.ts.
import {
  api,
  day,
  go,
  rows,
  type ServerTask,
  seedTask,
  settled,
  signIn,
  taskRow,
  tick,
  titleButton,
  trackSync,
  visitAndWait,
} from "./tasks-helpers"

Cypress.config("responseTimeout", 90000)

const done =
  "select id from task where id = $1 and status = 'done' and completed_at is not null"
const open =
  "select id from task where id = $1 and status = 'open' and completed_at is null and deleted_at is null"
const event = "select id from task_event where task_id = $1 and type = $2"

describe("tasks lifecycle (live)", () => {
  beforeEach(trackSync)

  it("Today and Plan rows: tick, untick, and the Upcoming / Overdue views", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, { title: "Today row task", due_date: day(0) }).then(
        (a: ServerTask) =>
          seedTask(user, { title: "Plan row task", due_date: day(0) }).then(
            (b: ServerTask) =>
              seedTask(user, { title: "Later task", due_date: day(2) }).then(
                () =>
                  seedTask(user, {
                    title: "Slipped task",
                    due_date: day(-2),
                  }).then(() => {
                    // Today tab: the Today card's row.
                    visitAndWait("/today", "Today row task")
                    tick("Today row task")
                    rows(done, [a.id])
                    rows(event, [a.id, "completed"])

                    // Plan → Tasks: done today, reopened from its row.
                    visitAndWait("/plan", "Plan row task")
                    cy.findByText(/DONE TODAY · 1/).click()
                    tick("Today row task")
                    rows(open, [a.id])
                    rows(event, [a.id, "uncompleted"])
                    settled()
                    tick("Plan row task")
                    rows(done, [b.id])
                    api<{ data: { id: string; status: string }[] }>(
                      user,
                      "/tasks/?status=done",
                      (body) => body.data.some((t) => t.id === b.id),
                    )

                    // The other views read the same synced rows.
                    cy.findByRole("tab", { name: "Upcoming" }).click()
                    titleButton("Later task").should("exist")
                    // The Overdue tab label is not a plain string, so its name is its value.
                    cy.findByRole("tab", { name: /overdue/i }).click()
                    titleButton("Slipped task").should("exist")
                  }),
              ),
          ),
      )
    })
  })

  it("recurring completion: the next occurrence has the same derived id on both sides", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, {
        title: "Stretch",
        due_date: day(0),
        recurrence: { mode: "fixed", rule: { kind: "daily" } },
      }).then((first: ServerTask) => {
        visitAndWait("/plan", "Stretch")
        tick("Stretch")
        rows(done, [first.id])
        rows(
          `select id from task where series_parent_id = $1 and status = 'open'
             and to_char(due_date, 'YYYY-MM-DD') = $2`,
          [first.id, day(1)],
        ).then(([next]) => {
          const nextId = String(next.id)
          // The device spawned the same id: its own create landed on the
          // server's row instead of making a second one.
          rows(
            "select id from task where owner_id = $1 and title = 'Stretch' and deleted_at is null",
            [user.id],
            2,
          ).then((all) => expect(all).to.have.length(2))
          go(`/tasks/task/${nextId}`)
          cy.findByRole("textbox", { name: "Title" }).should(
            "have.value",
            "Stretch",
          )
          api<{ id: string }>(user, `/tasks/${nextId}`, (b) => b.id === nextId)

          // Uncomplete: the untouched spawned occurrence goes away again,
          // on the server and on the device.
          go(`/tasks/task/${first.id}`)
          cy.findByRole("button", { name: "Mark not done" }).click()
          rows(open, [first.id])
          rows("select id from task where id = $1 and deleted_at is not null", [
            nextId,
          ])
          go(`/tasks/task/${nextId}`)
          cy.findByText("Task not found").should("exist")
        })
      })
    })
  })

  it("row actions sheet: star, snooze, tomorrow, delete + undo, complete, duplicate", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, { title: "Sheet task", due_date: day(0) }).then(
        (t: ServerTask) =>
          seedTask(user, { title: "Copy me" }).then(() => {
            visitAndWait("/tasks/list/inbox", "Sheet task")
            const action = (name: string) => {
              settled()
              cy.findByRole("button", {
                name: "Actions for Sheet task",
              }).click()
              cy.findByRole("button", { name }).click()
            }

            action("Star")
            rows("select id from task where id = $1 and starred", [t.id])

            const before = Date.now()
            action("Snooze 1 hour")
            rows(
              "select remind_at from task where id = $1 and remind_at is not null",
              [t.id],
            ).then(([r]) => {
              const at = new Date(String(r.remind_at)).getTime()
              expect(at).to.be.within(
                before + 59 * 60000,
                Date.now() + 61 * 60000,
              )
            })

            action("Tomorrow")
            rows(
              `select id from task where id = $1 and to_char(due_date, 'YYYY-MM-DD') = $2
                 and reschedule_count = 1`,
              [t.id, day(1)],
            )
            rows(event, [t.id, "rescheduled"])

            // Delete, then Undo from its toast (6 s; sonner-native renders
            // the action without a button role, so it is found by text).
            // The restore op itself is proven by "delete and restore".
            action("Delete")
            titleButton("Sheet task").should("not.exist")
            cy.findByText("Undo").click()
            titleButton("Sheet task").should("exist")
            settled()
            rows(open, [t.id])
            api<{ data: { id: string }[] }>(
              user,
              "/tasks/deleted",
              (b) => !b.data.some((x) => x.id === t.id),
            )

            action("Complete")
            rows(done, [t.id])

            settled()
            cy.findByRole("button", { name: "Actions for Copy me" }).click()
            cy.findByRole("button", { name: "Duplicate" }).click()
            rows(
              "select id from task where owner_id = $1 and title = 'Copy me' and deleted_at is null",
              [user.id],
              2,
            )
          }),
      )
    })
  })

  it("snooze from the detail screen pushes the reminder later", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      const remind = new Date(Date.now() + 2 * 3600000)
      remind.setSeconds(0, 0)
      seedTask(user, {
        title: "Snooze me",
        due_date: day(0),
        remind_at: remind.toISOString(),
      }).then((t: ServerTask) => {
        visitAndWait(`/tasks/task/${t.id}`, "Snooze reminder")
        cy.findByRole("button", { name: "3 hr" }).click()
        rows("select remind_at from task where id = $1 and remind_at > $2", [
          t.id,
          remind.toISOString(),
        ]).then(([r]) => {
          expect(new Date(String(r.remind_at)).getTime()).to.eq(
            remind.getTime() + 3 * 3600000,
          )
        })
      })
    })
  })

  it("move overdue to today: Triage → Move all to today", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, { title: "Late one", due_date: day(-1) }).then(
        (a: ServerTask) =>
          seedTask(user, { title: "Late two", due_date: day(-3) }).then(
            (b: ServerTask) => {
              visitAndWait("/plan", "Late two")
              cy.findAllByText("Triage").first().click()
              cy.findByText("Triage overdue tasks").should("exist")
              cy.findByRole("button", { name: "Move all to today" }).click()
              for (const t of [a, b]) {
                rows(
                  `select id from task where id = $1 and to_char(due_date, 'YYYY-MM-DD') = $2
                     and reschedule_count = 1`,
                  [t.id, day(0)],
                )
                rows(event, [t.id, "rescheduled"])
              }
              api<{ data: unknown[] }>(
                user,
                "/tasks/overdue",
                (body) => (body.data ?? []).length === 0,
              )
            },
          ),
      )
    })
  })

  it("delete and restore: detail delete, Recently deleted restore, detail restore, reopen", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, { title: "Old task" }).then((t: ServerTask) => {
        // The title is an input's value, not text: wait for the detail rows.
        visitAndWait(`/tasks/task/${t.id}`, "Add date")
        cy.findByRole("button", { name: "Delete" }).click()
        cy.location("pathname").should("eq", "/tasks")
        rows(
          "select id from task where id = $1 and status = 'deleted' and deleted_at is not null",
          [t.id],
        )
        api<{ data: { id: string }[] }>(user, "/tasks/deleted", (b) =>
          b.data.some((x) => x.id === t.id),
        )

        // Completed & deleted → Recently deleted → Restore.
        go("/tasks/completed")
        cy.findByRole("tab", { name: /Recently deleted · 1/ }).click()
        cy.findByText("Old task").should("exist")
        cy.findByRole("button", { name: "Restore" }).click()
        rows(open, [t.id])
        rows(event, [t.id, "restored"])

        // Delete again and restore from the detail screen's own button.
        go(`/tasks/task/${t.id}`)
        cy.findByRole("button", { name: "Delete" }).click()
        rows("select id from task where id = $1 and status = 'deleted'", [t.id])
        go(`/tasks/task/${t.id}`)
        cy.findByText(/^Deleted /).should("exist")
        cy.findAllByRole("button", { name: "Restore" }).last().click()
        rows(open, [t.id])

        // Complete, then Reopen from the Completed tab.
        settled()
        cy.findByRole("button", { name: "Complete" }).click()
        rows(done, [t.id])
        go("/tasks/completed")
        cy.findByText("Old task").should("exist")
        cy.findByRole("button", { name: "Reopen" }).click()
        rows(open, [t.id])
        api<{ status: string }>(
          user,
          `/tasks/${t.id}`,
          (b) => b.status === "open",
        )
      })
    })
  })

  it("delete a repeating task: This one makes the next, All future ends it", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, {
        title: "Daily standup",
        due_date: day(0),
        recurrence: { mode: "fixed", rule: { kind: "daily" } },
      }).then((t: ServerTask) => {
        visitAndWait(`/tasks/task/${t.id}`, "Daily standup")
        cy.findByRole("button", { name: "Delete" }).click()
        cy.findByText("Delete a repeating task").should("exist")
        cy.findByRole("button", { name: "This one" }).click()
        rows("select id from task where id = $1 and status = 'deleted'", [t.id])
        rows(
          `select id from task where owner_id = $1 and title = 'Daily standup'
             and status = 'open' and to_char(due_date, 'YYYY-MM-DD') = $2
             and recurrence is not null`,
          [user.id, day(1)],
        ).then(([next]) => {
          go(`/tasks/task/${next.id}`)
          cy.findByRole("button", { name: "Delete" }).click()
          cy.findByRole("button", { name: "All future" }).click()
          rows("select id from task where id = $1 and status = 'deleted'", [
            next.id,
          ])
          rows(
            "select 1 as none_open where not exists (select 1 from task where owner_id = $1 and status = 'open')",
            [user.id],
          )
        })
      })
    })
  })

  it("reorder: Manual sort, Move down swaps sort_order on the server", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, { title: "Alpha" }).then(() =>
        seedTask(user, { title: "Bravo" }).then(() =>
          seedTask(user, { title: "Charlie" }).then(() => {
            visitAndWait("/tasks/list/inbox", "Charlie")
            cy.findByRole("tab", { name: "Manual" }).click()
            cy.findByRole("button", { name: "Move Alpha down" }).click()
            rows(
              `select title from task where owner_id = $1 and title = 'Bravo'
                 and sort_order < (select sort_order from task where owner_id = $1 and title = 'Alpha')`,
              [user.id],
            )
            rows(
              "select title from task where owner_id = $1 order by sort_order, title",
              [user.id],
              3,
            ).then((found) =>
              expect(found.map((r) => r.title)).to.deep.eq([
                "Bravo",
                "Alpha",
                "Charlie",
              ]),
            )
            settled()
            cy.findByRole("button", { name: "Move Charlie up" }).click()
            rows(
              `select title from task where owner_id = $1 and title = 'Charlie'
                 and sort_order < (select sort_order from task where owner_id = $1 and title = 'Alpha')`,
              [user.id],
            )
            taskRow("Charlie").should("exist")
          }),
        ),
      )
    })
  })
})
