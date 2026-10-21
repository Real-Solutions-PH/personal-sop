// Tasks: what the screens do lands in the API and in Postgres.
//
// Inventory for the whole tasks module (this file plus tasks-*.cy.ts) —
// screen · action · test that covers it.
//
// | Screen                 | Action                                        | Test |
// |------------------------|-----------------------------------------------|------|
// | Quick capture          | split text into tasks                         | tasks · captures tasks, completes one, deletes one |
// | Quick capture          | natural language: date, time, repeat          | tasks · natural-language quick add |
// | Quick capture          | source chips (Text / Voice / Photo)           | tasks · natural-language quick add (Voice) |
// | Quick capture          | remove one row / Undo all                     | tasks · capture undo |
// | Quick capture          | follow-up reminder ("Remind you … at 1pm?")   | tasks · capture follow-up (vague task) |
// | List page (Inbox)      | quick add with natural language               | tasks · list quick add |
// | Task detail            | title, star, list, notes                      | tasks · detail edits every field |
// | Task detail            | date + time + reminder sheet, clear date      | tasks · detail edits every field |
// | Task detail            | repeat sheet (weekly, after completion), clear | tasks · detail edits every field |
// | Task detail            | Copy (duplicate)                              | tasks · detail edits every field |
// | Task detail            | Complete / Mark not done                      | tasks · captures …; lifecycle · detail complete |
// | Task detail            | snooze 1 hr / 3 hr                            | lifecycle · snooze |
// | Task detail            | Delete / Restore (banner + button)            | lifecycle · delete and restore |
// | Task detail            | delete repeating: This one / All future       | lifecycle · delete a repeating task |
// | Today (Today tab card) | tick / untick a task row                      | lifecycle · Today and Plan rows |
// | Plan → Tasks panel     | tick a row, Today / Upcoming / Overdue views  | lifecycle · Today and Plan rows |
// | Plan / Tasks · Overdue | Triage → Move all to today                    | lifecycle · move overdue to today |
// | Row actions sheet      | Complete, Snooze 1 hour, Tomorrow, Star,      | lifecycle · row actions sheet |
// |                        | Duplicate, Delete (+ Undo toast)              | lifecycle · row actions sheet |
// | Recurring task         | complete → next occurrence, same derived id   | lifecycle · recurring completion |
// | Recurring task         | uncomplete → spawned occurrence removed       | lifecycle · recurring completion |
// | List page              | Manual sort, Move up / Move down (reorder)    | lifecycle · reorder |
// | Completed & deleted    | Reopen, Restore (Recently deleted)            | lifecycle · delete and restore; completed screen |
// | Lists                  | New list (name, colour, icon, shopping)       | lists · create, edit, reorder, archive |
// | Lists                  | Edit, Move up / down, Archive, Unarchive      | lists · create, edit, reorder, archive |
// | List editor            | Delete → Move to Inbox                        | lists · delete a list, moving its tasks |
// | List editor            | Delete → Delete tasks                         | lists · delete a list with its tasks |
// | List page              | Edit list (header pencil)                     | lists · delete a list with its tasks |
// | Shopping list          | add items, check items, Clear checked, Undo   | lists · shopping list |
// | Smart views            | Inbox / Starred pages                         | lists · smart views |
// | Tasks settings         | default reminder, digest on + time, quiet     | settings · every settings row |
// |                        | hours, count groceries, week start            | settings · every settings row |
// | Reminders              | Enable → Allow / Don't Allow, Not now,        | settings · reminders (notification state) |
// |                        | simulate device (platform, installed), unblock | settings · reminders (notification state) |
// | Notification preview   | Done / Snooze 1h                              | settings · notification preview actions |
// | Search                 | text query, status / starred / list filters   | settings · search, stats, share read the data |
// | Task stats / Share     | numbers reflect the synced tasks              | settings · search, stats, share read the data |
// | Task detail            | priority                                      | NOT IN PRODUCT: tasks have no priority field; "Star" is the only flag (covered) |
// | Task detail            | subtasks / checklist                          | NOT IN PRODUCT: no subtask or checklist model on either side; shopping lists are the checklist (covered) |
import {
  api,
  day,
  dbTask,
  go,
  rows,
  type ServerTask,
  seedList,
  seedTask,
  settled,
  signIn,
  trackSync,
  visitAndWait,
} from "./tasks-helpers"

// The shared API is slow under the parallel E2E load (see tasks-helpers.ts).
Cypress.config("responseTimeout", 90000)

describe("tasks (live)", () => {
  beforeEach(trackSync)

  it("adds tasks from the form, completes one, deletes one — all reach the server", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      for (const title of ["Pay electric bill", "Call dentist"]) {
        go("/tasks/new")
        cy.findByRole("textbox", { name: "Task" }).type(title)
        cy.findByRole("button", { name: "Add task" }).click()
        cy.findByText("Task added").should("exist")
      }

      rows(
        "select id, title, status from task where owner_id = $1 and deleted_at is null order by title",
        [user.id],
        2,
      ).then((found) => {
        expect(found.map((r) => r.title)).to.deep.eq([
          "Call dentist",
          "Pay electric bill",
        ])
        const [dentist, bill] = found as { id: string }[]
        api<{ data: { title: string }[] }>(
          user,
          "/tasks/",
          (b) => b.data.length === 2,
        )

        // Complete one from its detail screen: a domain action on the server.
        go(`/tasks/task/${dentist.id}`)
        cy.findByRole("button", { name: "Complete" }).click()
        rows(
          "select status, completed_at from task where id = $1 and status = 'done' and completed_at is not null",
          [dentist.id],
        )
        rows(
          "select type from task_event where task_id = $1 and type = 'completed'",
          [dentist.id],
        )

        // Delete the other: a tombstone, so other devices drop it too.
        go(`/tasks/task/${bill.id}`)
        cy.findByRole("button", { name: "Delete" }).click()
        rows(
          "select status from task where id = $1 and status = 'deleted' and deleted_at is not null",
          [bill.id],
        )
        api<{ data: { id: string }[] }>(
          user,
          "/tasks/",
          (b) => !b.data.some((t) => t.id === bill.id),
        )
      })
    })
  })

  it("natural-language quick add: date, time, repeat and source reach the server", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      go("/tasks/capture")
      cy.findByRole("button", { name: "Voice" }).click()
      cy.findByRole("textbox", { name: "Capture text" })
        .clear()
        .type("Submit report tomorrow at 5pm, water plants every day")
      cy.findByRole("button", { name: "Send" }).click()
      cy.findByText(/saved 2 tasks/i).should("exist")

      rows(
        `select title, to_char(due_date, 'YYYY-MM-DD') as due, due_time,
                remind_at, recurrence, source
           from task where owner_id = $1 order by title`,
        [user.id],
        2,
      ).then(([report, plants]) => {
        expect(report.title).to.eq("Submit report")
        expect(report.due).to.eq(day(1))
        expect(report.due_time).to.eq("17:00")
        expect(report.remind_at, "a dated capture gets a reminder").not.to.eq(
          null,
        )
        expect(report.source).to.eq("capture-voice")
        expect(plants.title).to.eq("Water plants")
        expect(plants.due).to.eq(day(0))
        expect(plants.recurrence).to.deep.eq({
          mode: "fixed",
          rule: { kind: "daily" },
        })
      })
      rows(
        `select e.type from task_event e join task t on t.id = e.task_id
          where t.owner_id = $1 and e.type = 'created'`,
        [user.id],
        2,
      )
      api<{ data: { title: string; due_time: string | null }[] }>(
        user,
        "/tasks/",
        (b) =>
          b.data.some(
            (t) => t.title === "Submit report" && t.due_time === "17:00",
          ),
      )
    })
  })

  it("capture undo: removing one row and Undo all reach the server", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      go("/tasks/capture")
      cy.findByRole("textbox", { name: "Capture text" })
        .clear()
        .type("Book flights, renew passport, pack bags")
      cy.findByRole("button", { name: "Send" }).click()
      cy.findByText(/saved 3 tasks/i).should("exist")
      rows(
        "select id from task where owner_id = $1 and deleted_at is null",
        [user.id],
        3,
      )

      // One row: gone on the server, and not in Recently deleted (a capture
      // undo is not a user delete).
      settled()
      cy.findByRole("button", { name: "Remove Pack bags" }).click()
      cy.findByText(/saved 2 tasks/i).should("exist")
      rows(
        "select id from task where owner_id = $1 and title = 'Pack bags' and deleted_at is not null",
        [user.id],
      )

      settled()
      cy.findByText("Undo all").click()
      cy.findByText("Undone — nothing was saved.").should("exist")
      rows(
        "select id from task where owner_id = $1 and deleted_at is not null",
        [user.id],
        3,
      )
      api<{ data: unknown[] }>(user, "/tasks/", (b) => b.data.length === 0)
      cy.liveApi<{ data: { title: string }[] }>(user, "GET", "/tasks/deleted")
        .its("data")
        .should("have.length", 0)
    })
  })

  it("capture follow-up: the 1pm reminder offer sets time and reminder", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      go("/tasks/capture")
      // "after lunch" is vague: no time, so the result card offers a reminder.
      cy.findByRole("textbox", { name: "Capture text" })
        .clear()
        .type("Call the bank after lunch")
      cy.findByRole("button", { name: "Send" }).click()
      cy.findByText(/Remind you about/).should("exist")
      cy.findByText("1 PM").click()
      rows(
        "select due_time, remind_at from task where owner_id = $1 and due_time = '13:00' and remind_at is not null",
        [user.id],
      )
    })
  })

  it("list quick add parses the phrase into the Inbox", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      go("/tasks/list/inbox")
      cy.findByRole("textbox", { name: "Add task" }).type(
        "Call mom tomorrow 9am{enter}",
      )
      rows(
        `select title, list_id, to_char(due_date, 'YYYY-MM-DD') as due, due_time, remind_at
           from task where owner_id = $1`,
        [user.id],
      ).then(([t]) => {
        expect(t.title).to.eq("Call mom")
        expect(t.list_id).to.eq(null)
        expect(t.due).to.eq(day(1))
        expect(t.due_time).to.eq("09:00")
        expect(t.remind_at).not.to.eq(null)
      })
    })
  })

  it("detail edits every field: title, star, list, notes, date, reminder, repeat, copy", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedList(user, { name: "Errands" }).then((list) => {
        seedTask(user, { title: "Draft plan" }).then((task: ServerTask) => {
          visitAndWait(`/tasks/task/${task.id}`, "Errands")
          cy.findByRole("textbox", { name: "Title" }).should(
            "have.value",
            "Draft plan",
          )

          cy.findByRole("textbox", { name: "Title" })
            .clear()
            .type("Draft the plan")
          settled()
          cy.findByRole("button", { name: "Star" }).click()
          settled()
          cy.findByText("Errands").click()
          settled()
          cy.findByRole("textbox", { name: "Notes" }).type("Two pages max")
          rows(
            `select id from task where id = $1 and title = 'Draft the plan'
               and starred and list_id = $2 and notes = 'Two pages max'`,
            [task.id, list.id],
          )

          // Date, time and a reminder one hour before.
          settled()
          cy.findByText("Add date").click()
          cy.findByRole("textbox", { name: "Date" }).clear().type(day(3))
          cy.findByRole("textbox", { name: "Time (optional)" })
            .clear()
            .type("15:30")
          cy.findByRole("button", { name: "1 hour before" }).click()
          cy.findByRole("button", { name: "Save" }).click()
          rows(
            `select remind_at from task where id = $1
               and to_char(due_date, 'YYYY-MM-DD') = $2 and due_time = '15:30'
               and remind_at is not null`,
            [task.id, day(3)],
          ).then(([r]) => {
            const [y, m, d] = day(3).split("-").map(Number)
            const expected = new Date(y, m - 1, d, 14, 30).getTime()
            expect(new Date(String(r.remind_at)).getTime()).to.eq(expected)
          })

          // Repeat: weekly on Monday and Wednesday, after completion.
          settled()
          cy.findByText("Repeat").click()
          cy.findByRole("button", { name: "Weekly" }).click()
          cy.findByRole("button", { name: "Mo" }).click()
          cy.findByRole("button", { name: "We" }).click()
          cy.findByRole("switch", { name: "Repeat after completion" }).click()
          cy.findByRole("button", { name: "Set repeat" }).click()
          rows(
            "select recurrence from task where id = $1 and recurrence->>'mode' = 'after'",
            [task.id],
          ).then(([r]) => {
            const rec = r.recurrence as {
              rule: { kind: string; days: number[] }
            }
            expect(rec.rule.kind).to.eq("weekly")
            // The due day's weekday starts selected; Mo and We are added.
            expect(rec.rule.days).to.include.members([1, 3])
          })
          api<{ recurrence: { mode: string } | null }>(
            user,
            `/tasks/${task.id}`,
            (b) => b.recurrence?.mode === "after",
          )

          // Clear the repeat and the date again.
          settled()
          cy.findByRole("button", { name: "Clear Repeat" }).click()
          cy.findByRole("button", { name: "Clear Add date" }).click()
          rows(
            // The server stores a cleared recurrence as JSON null, not SQL NULL.
            `select id from task where id = $1
               and (recurrence is null or jsonb_typeof(recurrence) = 'null')
               and due_date is null and remind_at is null`,
            [task.id],
          )

          // Copy: a second task with the same title and list.
          settled()
          cy.findByRole("button", { name: "Copy" }).click()
          rows(
            "select id from task where owner_id = $1 and title = 'Draft the plan' and list_id = $2 and deleted_at is null",
            [user.id, list.id],
            2,
          )
          dbTask(task.id).its("status").should("eq", "open")
        })
      })
    })
  })
})
