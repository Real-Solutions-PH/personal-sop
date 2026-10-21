// Tasks settings, reminders (notification state), the notification preview
// and the read surfaces (search, stats, share card), proven in the API and
// in Postgres. Inventory: see tasks.cy.ts.
import {
  api,
  day,
  go,
  rows,
  type ServerTask,
  seedTask,
  settled,
  signIn,
  titleButton,
  trackSync,
  visitAndWait,
} from "./tasks-helpers"

Cypress.config("responseTimeout", 90000)

/** Replace a web time field's text; it saves once the value is HH:MM. */
const setTime = (label: string, value: string) =>
  cy.findByRole("textbox", { name: label }).clear().type(value).blur()

describe("tasks settings (live)", () => {
  beforeEach(trackSync)

  it("every settings row lands in task_settings", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      // The first sync writes this user's settings row.
      rows("select * from task_settings where owner_id = $1", [user.id]).then(
        ([initial]) => {
          visitAndWait("/tasks/settings", "Default reminder time")

          settled()
          setTime("Default reminder time", "08:15")
          rows(
            "select id from task_settings where owner_id = $1 and default_remind_time = '08:15'",
            [user.id],
          )

          // Digest on, and its time field appears.
          settled()
          cy.findByRole("switch", { name: "Morning digest" }).then(($s) => {
            if ($s.attr("aria-checked") === "true") cy.wrap($s).click()
          })
          settled()
          cy.findByRole("switch", { name: "Morning digest" }).click()
          rows(
            "select id from task_settings where owner_id = $1 and digest_on",
            [user.id],
          )
          settled()
          setTime("Digest time", "06:45")
          rows(
            "select id from task_settings where owner_id = $1 and digest_time = '06:45'",
            [user.id],
          )

          settled()
          setTime("Quiet hours start", "23:30")
          settled()
          setTime("Quiet hours end", "06:30")
          rows(
            `select id from task_settings where owner_id = $1
               and quiet_start = '23:30' and quiet_end = '06:30'`,
            [user.id],
          )

          settled()
          cy.findByRole("switch", { name: "Count groceries in stats" }).click()
          rows(
            "select id from task_settings where owner_id = $1 and count_groceries = $2",
            [user.id, !initial.count_groceries],
          )

          settled()
          cy.findByRole("tab", { name: "Sun" }).click()
          rows(
            "select id from task_settings where owner_id = $1 and week_start = 0",
            [user.id],
          )

          api<{
            default_remind_time: string
            digest_on: boolean
            week_start: number
          }>(
            user,
            "/tasks/settings",
            (b) =>
              b.default_remind_time === "08:15" &&
              b.digest_on &&
              b.week_start === 0,
          )

          // The rows link on to Reminders and Lists.
          settled()
          cy.findByText("Manage lists").click()
          cy.location("pathname").should("eq", "/tasks/lists")
        },
      )
    })
  })

  it("reminders: install step, enable → allow, simulate device, block, unblock, not now", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      const notif = (where: string, values: unknown[] = []) =>
        rows(
          `select * from task_notif_state where owner_id = $1 and ${where}`,
          [user.id, ...values],
        )
      notif("platform = 'ios' and not installed")
      go("/tasks/settings")
      settled()
      cy.findByText("This device").click()
      cy.location("pathname").should("eq", "/tasks/reminders")

      // iOS needs the Home Screen install first.
      settled()
      cy.findByRole("button", { name: "Remind me later" }).click()
      notif("remind_later_at is not null")
      settled()
      cy.findByRole("button", { name: "I've added it" }).click()
      notif("installed")

      settled()
      cy.findByRole("button", { name: "Enable notifications" }).click()
      settled()
      cy.findByRole("button", { name: "Allow" }).click()
      notif("permission = 'granted' and test_sent_at is not null")

      // The simulated device controls.
      settled()
      cy.findByText("Prototype: simulate device").click()
      settled()
      cy.findByRole("tab", { name: "Android" }).click()
      notif("platform = 'android'")
      settled()
      cy.findByRole("switch", { name: "Installed to Home Screen" }).click()
      notif("not installed")
      settled()
      cy.findByRole("tab", { name: "Blocked" }).click()
      notif("permission = 'denied'")
      settled()
      cy.findByRole("button", { name: "I've turned it back on" }).click()
      notif("permission = 'default'")

      // Not now / Don't Allow.
      settled()
      cy.findByRole("button", { name: "Enable notifications" }).click()
      settled()
      cy.findByRole("button", { name: "Don't Allow" }).click()
      notif("permission = 'denied'")
      api<{ platform: string; permission: string }>(
        user,
        "/tasks/notif",
        (b) => b.platform === "android" && b.permission === "denied",
      )
    })
  })

  it("notification preview: Done and Snooze 1h act on the task", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      const at = (h: number) => {
        const d = new Date()
        d.setHours(h, 0, 0, 0)
        return d.toISOString()
      }
      seedTask(user, {
        title: "Ping one",
        due_date: day(0),
        due_time: "23:00",
        remind_at: at(23),
      }).then((a: ServerTask) =>
        seedTask(user, {
          title: "Ping two",
          due_date: day(1),
          due_time: "10:00",
          remind_at: new Date(Date.now() + 26 * 3600000).toISOString(),
        }).then((b: ServerTask) => {
          // Done / Snooze show on Android and desktop only: switch the
          // simulated device first.
          visitAndWait("/tasks/reminders", "Prototype: simulate device")
          settled()
          cy.findByText("Prototype: simulate device").click()
          settled()
          cy.findByRole("tab", { name: "Android" }).click()
          rows(
            "select id from task_notif_state where owner_id = $1 and platform = 'android'",
            [user.id],
          )
          visitAndWait("/tasks/notification", "Ping one")
          settled()
          cy.findAllByText("Done").first().click()
          rows("select id from task where id = $1 and status = 'done'", [a.id])
          settled()
          cy.findAllByText("Snooze 1h").first().click()
          rows("select remind_at from task where id = $1 and remind_at > $2", [
            b.id,
            new Date(Date.now() + 26.5 * 3600000).toISOString(),
          ])
        }),
      )
    })
  })

  it("search, stats and the share card read the synced tasks", () => {
    cy.newLiveUser("tasks").then((user) => {
      signIn(user)
      seedTask(user, {
        title: "Renew car insurance",
        notes: "policy 42",
        starred: true,
        due_date: day(0),
      }).then((t: ServerTask) =>
        seedTask(user, { title: "Unrelated chore" }).then(() => {
          visitAndWait("/tasks/search", "Unrelated chore")
          cy.findByRole("textbox", { name: "Search tasks" }).type("policy")
          titleButton("Renew car insurance").should("exist")
          titleButton("Unrelated chore").should("not.exist")
          settled()
          cy.findByRole("button", { name: "Clear search" }).click()
          settled()
          cy.findByRole("button", { name: "Starred" }).click()
          titleButton("Renew car insurance").should("exist")
          titleButton("Unrelated chore").should("not.exist")
          settled()
          cy.findByRole("button", { name: "Starred" }).click()
          settled()
          cy.findByRole("button", { name: "Has date" }).click()
          titleButton("Unrelated chore").should("not.exist")

          // Complete it, then the stats count it, as the server does.
          go(`/tasks/task/${t.id}`)
          settled()
          cy.findByRole("button", { name: "Complete" }).click()
          rows("select id from task where id = $1 and status = 'done'", [t.id])
          api<{ current: { done: number } }>(
            user,
            "/tasks/stats?days=7",
            (b) => b.current.done >= 1,
          )
          visitAndWait("/tasks/stats", "Tasks done")
          cy.findByText("Tasks done").parent().should("contain.text", "1")
          settled()
          cy.findByRole("button", { name: "Share" }).click()
          cy.location("pathname").should("eq", "/tasks/share")
          cy.findByText("Share card").should("exist")
        }),
      )
    })
  })
})
