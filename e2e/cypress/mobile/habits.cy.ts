// Habits (live): what the habit screens do lands in the API and in Postgres.
//
// Inventory — screen · action · test ("core:" = this file; the timer,
// routines and workout link live in habits-timer / habits-routines /
// habits-workout.cy.ts).
//
// | Screen                     | Action                                   | Test |
// |----------------------------|------------------------------------------|------|
// | /habits/new (form)         | name, icon, type, target/unit/step, schedule sheet, reminder, create | core: creates a count habit |
// | /habits/[id]/edit          | rename, change target, save              | core: creates a count habit |
// | /habits/[id]/edit          | Pause / Resume buttons                   | core: pauses and resumes from the edit form |
// | /habits/[id]/edit          | Pause again the day of a resume          | core: pauses again on the day of a resume (regression check for the deleted-id restore) |
// | /habits/[id]/edit          | Archive button                           | core: pauses, resumes, archives (form archive) |
// | /habits/[id] (detail)      | + step (increment)                       | core: creates a count habit |
// | /habits/[id] (detail)      | Mark done today / undo (check, clear)    | core: checks, clears, skips |
// | /habits/[id] (detail)      | Log… sheet: status, value, note, save    | core: checks, clears, skips |
// | /habits/[id] (detail)      | Log sheet: Clear log                     | core: checks, clears, skips |
// | /habits/[id] (detail)      | Log sheet: Yesterday (backfill)          | core: backfills |
// | /habits/[id] (detail)      | Recent logs row → reopen log sheet       | core: backfills |
// | /habits/[id] (detail)      | More → Pause… (preset, reason) / Resume  | core: pauses, resumes |
// | /habits/[id] (detail)      | More → Archive                           | core: pauses, resumes, archives |
// | /habits/[id] (detail)      | More → Share                             | core: share card |
// | /habits/[id] (detail)      | calendar cell → day editor               | core: backfills |
// | /habits/day/[day]          | Done / Partial / Skip / Missed chips, value field | core: day editor |
// | /habits/day/[day]          | Previous / Next day                      | core: day editor (days before a habit's creation list nothing by design) |
// | /habits/manage             | Reorder → Move up / down                 | core: reorders |
// | /habits/manage             | Today / All segment, Filter & sort sheet (search, status, type, time, sort) | core: reorders (client-side only, no server effect) |
// | /habits/manage/archived    | Restore, Delete                          | core: pauses, resumes, archives |
// | /habits/settings           | Week starts on, default reminder, streak nudge | core: settings |
// | /habits/settings           | Notifications Enable sheet               | core: settings (client sheet, nothing to persist) |
// | /habits/settings           | Reset habits demo data / Reset every section | core: live mode offers no demo resets (prototype-only since the fix; they deleted the user's server habits) |
// | /habits/share              | card composer, layout, toggles           | core: share card (renders server data) |
// | /habits/share              | share / save image                       | NOT COVERABLE ON WEB: native share sheet / image capture |
// | /habits (home analytics)   | period, sort chips, links                | core: home analytics (client-side over synced data) |
// | Today → Habits card        | Complete / Reopen check, +step           | core: Today rows |
// | Today → Habits card        | swipe to complete / swipe for more       | NOT COVERABLE ON WEB: gesture-only; the checkbox on the same row is covered |
// | Plan → Habits (/habits/week)| week strip, Edit day                    | core: Plan habits |
// | /habits/[id]/timer         | start, pause, resume, +5m, stop→save, discard, minimise → Live bar | habits-timer.cy.ts |
// | routines list/detail/form/player/summary | see habits-routines.cy.ts  | habits-routines.cy.ts |
// | habit linked to workouts   | ticked by a finished workout             | habits-workout.cy.ts |
import {
  apiUntil,
  businessDay,
  dbRows,
  type Row as Habit,
  type HabitListRow,
  pulled,
  seedHabit,
  signIn,
} from "./habits-helpers"

const TODAY = businessDay()
const YESTERDAY = businessDay(-1)
const habitIdFromUrl = () =>
  cy.location("pathname").then((p) => p.split("/")[2])

/** One live (not soft-deleted) log row for habit + day. */
const liveLog = (habitId: string, day: string, extra = "") =>
  dbRows(
    `select status, value, note, source from habit_log
      where habit_id = $1 and day = $2::date and deleted_at is null ${extra}`,
    [habitId, day],
  )
/** Passes once habit + day has no live log. */
const noLiveLog = (habitId: string, day: string) =>
  dbRows(
    `select 1 as gone where not exists (select 1 from habit_log
      where habit_id = $1 and day = $2::date and deleted_at is null)`,
    [habitId, day],
  )

describe("habits (live)", () => {
  it("creates a count habit, edits it and increments it", () => {
    cy.newLiveUser("habits").then((user) => {
      signIn(user)
      cy.visit("/habits/new")
      cy.findByRole("textbox", { name: "Name" }).type("Water")
      cy.findByRole("button", { name: "Choose 💧" }).click()
      cy.findByRole("tab", { name: "# Count" }).click()
      cy.findByRole("textbox", { name: "Target" }).clear().type("8")
      cy.findByRole("textbox", { name: "Unit" }).type("glasses")
      cy.findByRole("textbox", { name: "“+” adds" }).clear().type("2")
      cy.findByRole("button", { name: "Schedule" }).click()
      cy.findByRole("button", { name: "Every day" }).click()
      cy.findByRole("button", { name: "Done" }).click()
      cy.findByRole("button", { name: "Every day" }).should("not.exist")
      // New habits start from the "default reminder" setting; flip it and
      // read the state back from the switch's "on" copy.
      cy.findByRole("switch", { name: "Reminder" }).click()
      cy.get("body").then(($b) => {
        const on = $b
          .text()
          .includes("Reminder delivery is simulated in this prototype.")
        cy.wrap(on).as("reminderOn")
      })
      cy.findByRole("button", { name: "Create habit" }).click()
      cy.location("pathname").should("match", /^\/habits\/[0-9a-f-]{36}$/)
      habitIdFromUrl().then((id) => {
        dbRows(
          `select name, icon, type, target, unit, step, reminder, schedule
             from habit where id = $1 and owner_id = $2`,
          [id, user.id],
        ).then(([h]) => {
          expect(h).to.include({
            name: "Water",
            icon: "💧",
            type: "count",
            target: 8,
            unit: "glasses",
            step: 2,
          })
          cy.get("@reminderOn").then((on) => expect(h.reminder).to.eq(on))
          expect(h.schedule).to.deep.eq([{ days: [0, 1, 2, 3, 4, 5, 6] }])
        })
        apiUntil<{ data: HabitListRow[] }>(user, "/habits/", (b) =>
          b.data.some((x) => x.habit.id === id && x.habit.name === "Water"),
        )

        // Increment from the detail: one tap = one "+ step".
        cy.findByRole("button", { name: /^\+ 2 glasses/ }).click()
        cy.findByRole("button", { name: /\+ 2 glasses · 2\/8/ }).click()
        liveLog(id, TODAY, "and value = 4").then(([l]) =>
          expect(l.status).to.eq("partial"),
        )

        // Edit: rename and raise the target.
        cy.findByRole("button", { name: "Edit habit" }).click()
        cy.findByRole("textbox", { name: "Name" }).clear().type("Water intake")
        cy.findByRole("textbox", { name: "Target" }).clear().type("10")
        cy.findByRole("button", { name: "Save changes" }).click()
        dbRows(
          "select 1 from habit where id = $1 and name = 'Water intake' and target = 10",
          [id],
        )
        apiUntil<{ habit: { name: string } }>(
          user,
          `/habits/${id}`,
          (b) => b.habit.name === "Water intake",
        )
      })
    })
  })

  it("checks, clears and skips a habit with a note from the detail", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Floss", type: "check" }).then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Floss")
        cy.findByRole("button", { name: "Mark done today" }).click()
        liveLog(h.id, TODAY, "and status = 'done'")
        apiUntil<{ data: { status: string }[] }>(
          user,
          `/habits/${h.id}/logs`,
          (b) => b.data.some((l) => l.status === "done"),
        )

        cy.findByRole("button", { name: "✓ Done today — undo" }).click()
        noLiveLog(h.id, TODAY)

        // The log sheet: skip with a note.
        cy.findByRole("button", { name: "Log…" }).click()
        cy.findByRole("button", { name: "skipped" }).click()
        cy.findByLabelText("Note").type("Out of floss")
        cy.findByRole("button", { name: "Save log" }).click()
        liveLog(h.id, TODAY, "and status = 'skipped'").then(([l]) =>
          expect(l.note).to.eq("Out of floss"),
        )
        cy.findByText(/Out of floss/).should("exist")

        // Clear log from the same sheet.
        cy.findByRole("button", { name: "Log…" }).click()
        cy.findByRole("button", { name: "Clear log" }).click()
        noLiveLog(h.id, TODAY)
      })
    })
  })

  it("backfills yesterday from the log sheet and edits it from Recent logs", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, {
        name: "Read",
        type: "duration",
        target: 20,
      }).then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Read")
        cy.findByRole("button", { name: "Log…" }).click()
        cy.findByRole("button", { name: "partial" }).click()
        cy.findByLabelText("Minutes").clear().type("12")
        cy.findByRole("button", { name: "Yesterday" }).click()
        cy.findByLabelText("Day (YYYY-MM-DD)").should("have.value", YESTERDAY)
        cy.findByLabelText("Note").type("Late start")
        cy.findByRole("button", { name: "Save log" }).click()
        liveLog(h.id, YESTERDAY, "and status = 'partial' and value = 12").then(
          ([l]) => expect(l.note).to.eq("Late start"),
        )
        noLiveLog(h.id, TODAY)

        // Recent logs → reopen yesterday's log and finish it.
        cy.findByText(/Late start/).click()
        cy.findByRole("button", { name: "done" }).click()
        cy.findByLabelText("Minutes").clear().type("25")
        cy.findByRole("button", { name: "Save log" }).click()
        liveLog(h.id, YESTERDAY, "and status = 'done' and value = 25")
        apiUntil<{ data: { day: string; value: number }[] }>(
          user,
          `/habits/${h.id}/logs`,
          (b) => b.data.some((l) => l.day === YESTERDAY && l.value === 25),
        )
      })
    })
  })

  it("day editor: done, partial, skip and missed chips for today", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Pushups", type: "count", target: 30 }).then(
        (h) => {
          signIn(user)
          // Reached through the detail calendar (today's cell).
          cy.visit(`/habits/${h.id}`)
          pulled("Pushups")
          cy.findByRole("button", { name: new RegExp(`^${TODAY}: `) }).click()
          cy.location("pathname").should("eq", `/habits/day/${TODAY}`)
          cy.findByLabelText("Pushups value").type("20")
          cy.findByRole("button", { name: "Partial" }).click()
          liveLog(h.id, TODAY, "and status = 'partial' and value = 20")
          cy.findByRole("button", { name: "Done" }).click()
          liveLog(h.id, TODAY, "and status = 'done'")
          cy.findByRole("button", { name: "Skip" }).click()
          liveLog(h.id, TODAY, "and status = 'skipped'")
          cy.findByRole("button", { name: /^(Not yet|Missed)$/ }).click()
          noLiveLog(h.id, TODAY)

          // Previous day: the habit was created today, so it lists nothing.
          cy.findByRole("button", { name: "Previous day" }).click()
          cy.findByText("Nothing scheduled — rest day.").should("exist")
        },
      )
    })
  })

  it("pauses, resumes, archives, restores and deletes a habit", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Meditate", type: "check" }).then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Meditate")
        cy.findByRole("button", { name: "More" }).click()
        cy.findByRole("button", { name: "Pause…" }).click()
        cy.findByText("1 week").click()
        cy.findByLabelText("Reason (optional)").type("Travel")
        cy.findByRole("button", { name: /^Pause until / }).click()
        dbRows(
          `select p.from_day, p.to_day, p.reason, h.status
             from habit_pause p join habit h on h.id = p.habit_id
            where p.habit_id = $1 and p.deleted_at is null`,
          [h.id],
        ).then(([p]) => {
          expect(p.reason).to.eq("Travel")
          expect(p.status).to.eq("paused")
        })
        cy.findByText(/^Paused until .* · Travel$/).should("exist")

        cy.findByRole("button", { name: "Resume" }).click()
        dbRows("select 1 from habit where id = $1 and status = 'active'", [
          h.id,
        ])
        // A same-day resume drops the pause range entirely.
        dbRows(
          `select 1 as gone where not exists (select 1 from habit_pause
            where habit_id = $1 and deleted_at is null)`,
          [h.id],
        )

        // Archive from the detail's More sheet.
        cy.visit(`/habits/${h.id}`)
        cy.findByRole("button", { name: "More" }).click()
        cy.findByRole("button", { name: "Archive" }).click()
        cy.location("pathname").should("eq", "/habits/manage")
        dbRows(
          "select 1 from habit where id = $1 and status = 'archived' and archived_at is not null",
          [h.id],
        )
        apiUntil<{ data: Habit[] }>(user, "/habits/archived", (b) =>
          JSON.stringify(b).includes(h.id),
        )

        // Restore from Archived.
        cy.findByRole("button", { name: "Archived habits" }).click()
        pulled("Meditate")
        cy.findByRole("button", { name: "Restore" }).click()
        dbRows(
          "select 1 from habit where id = $1 and status = 'active' and archived_at is null",
          [h.id],
        )

        // Archive from the edit form, then delete forever from Archived.
        cy.visit(`/habits/${h.id}/edit`)
        cy.findByRole("button", { name: "Archive" }).click()
        cy.location("pathname").should("eq", "/habits/manage")
        dbRows("select 1 from habit where id = $1 and status = 'archived'", [
          h.id,
        ])
        cy.visit("/habits/manage/archived")
        cy.findByRole("button", { name: "Delete" }).click()
        dbRows("select 1 from habit where id = $1 and deleted_at is not null", [
          h.id,
        ])
        cy.findByText("Nothing archived").should("exist")
        apiUntil<{ habits?: Habit[] }>(
          user,
          "/habits/archived",
          (b) => !JSON.stringify(b).includes(h.id),
        )
      })
    })
  })

  it("pauses and resumes a habit from the edit form", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Yoga", type: "check" }).then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Yoga")
        cy.findByRole("button", { name: "Edit habit" }).click()
        cy.findByRole("textbox", { name: "Name" }).should("have.value", "Yoga")
        cy.findByRole("button", { name: "Pause" }).click()
        dbRows(
          `select 1 from habit h join habit_pause p on p.habit_id = h.id
            where h.id = $1 and h.status = 'paused' and p.to_day is null
              and p.deleted_at is null`,
          [h.id],
        )
        cy.findByRole("button", { name: "Resume" }).click()
        dbRows("select 1 from habit where id = $1 and status = 'active'", [
          h.id,
        ])
        apiUntil<{ status: string }>(user, `/habits/${h.id}`, (b) =>
          JSON.stringify(b).includes('"status":"active"'),
        )
      })
    })
  })

  // Regression check: a second pause on the same day reuses the first
  // pause's derived id (habit + from day), deleted by the resume; the engine
  // restores it before the upsert instead of hitting `deleted_on_server`.
  it("pauses again on the day of a resume, then resumes", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Tea", type: "check" }).then((h) => {
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Tea")
        cy.findByRole("button", { name: "Edit habit" }).click()
        cy.findByRole("textbox", { name: "Name" }).should("have.value", "Tea")
        cy.findByRole("button", { name: "Pause" }).click()
        dbRows("select 1 from habit where id = $1 and status = 'paused'", [
          h.id,
        ])
        cy.findByRole("button", { name: "Resume" }).click()
        dbRows("select 1 from habit where id = $1 and status = 'active'", [
          h.id,
        ])
        cy.findByRole("button", { name: "Pause" }).click()
        dbRows(
          `select 1 from habit_pause where habit_id = $1 and deleted_at is null`,
          [h.id],
        )
        cy.findByRole("button", { name: "Resume" }).click()
        dbRows("select 1 from habit where id = $1 and status = 'active'", [
          h.id,
        ])
      })
    })
  })

  it("reorders habits on the manage list", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Alpha" }).then((a) =>
        seedHabit(user, { name: "Bravo" }).then((b) => {
          cy.task<{ id: string; sort_order: number }[]>("sql", {
            text: "select id, sort_order from habit where id = any($1) order by sort_order",
            values: [[a.id, b.id]],
          }).then((before) => {
            expect(before.map((r) => r.id)).to.deep.eq([a.id, b.id])
          })
          signIn(user)
          cy.visit("/habits/manage")
          pulled("Bravo")
          // Client-side search narrows the list without touching the server.
          cy.findByRole("button", { name: "Filter & sort" }).click()
          cy.findByLabelText("Search habits").type("alp")
          cy.findByRole("button", { name: "Apply" }).click()
          cy.findByText("Bravo").should("not.exist")
          cy.findByRole("button", { name: "Filtered" }).click()
          cy.findByRole("button", { name: "Reset" }).click()

          cy.findByRole("button", { name: "Reorder" }).click()
          cy.findByRole("button", { name: "Move Bravo up" }).click()
          dbRows(
            `select 1 from habit a, habit b where a.id = $1 and b.id = $2
               and b.sort_order < a.sort_order`,
            [a.id, b.id],
          )
          apiUntil<{ data: HabitListRow[] }>(
            user,
            "/habits/",
            (r) => r.data[0]?.habit.id === b.id,
          )
        }),
      )
    })
  })

  it("settings: week start and the two switches persist", () => {
    cy.newLiveUser("habits").then((user) => {
      signIn(user)
      cy.visit("/habits/settings")
      cy.findByRole("tab", { name: "Sunday" }).click()
      // The first write creates the row from the device's whole settings,
      // so after it lands the server matches what the switches show.
      dbRows(
        `select week_start, default_reminder, streak_nudge from habit_settings
          where owner_id = $1 and deleted_at is null and week_start = 0`,
        [user.id],
      ).then(([before]) => {
        cy.findByRole("switch", { name: "Default reminder" }).click()
        cy.findByRole("switch", { name: "Streak nudge" }).click()
        dbRows(
          `select 1 from habit_settings
            where owner_id = $1 and deleted_at is null and week_start = 0
              and default_reminder = $2 and streak_nudge = $3`,
          [user.id, !before.default_reminder, !before.streak_nudge],
        )
        apiUntil<{ week_start: number; default_reminder: boolean }>(
          user,
          "/habits/settings",
          (b) =>
            b.week_start === 0 &&
            b.default_reminder === !before.default_reminder,
        )
        // A new habit starts with the default reminder setting.
        cy.visit("/habits/new")
        // The switch has no aria-checked on web; its "on" copy shows instead.
        cy.findByText(
          "Reminder delivery is simulated in this prototype.",
        ).should(before.default_reminder ? "not.exist" : "exist")
        cy.visit("/habits/settings")
      })
      // The Notifications sheet is client-only copy.
      cy.findByRole("button", { name: "Enable" }).click()
      cy.findByText("Turn on reminders").should("exist")
      cy.findByRole("button", { name: "Not now" }).click()
    })
  })

  // Regression check: in live mode "Reset habits demo data" used to replace
  // the store with the demo seed, and sync deleted the user's real habits.
  it("live mode offers no demo resets, and the user's habits stay", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Keep me" }).then((h) => {
        signIn(user)
        cy.visit("/habits/manage")
        pulled("Keep me")
        cy.visit("/habits/settings")
        cy.findByText("Week starts on").should("exist")
        cy.findByRole("button", { name: "Reset habits demo data" }).should(
          "not.exist",
        )
        cy.findByText("Reset every section").should("not.exist")
        cy.task<unknown[]>("sql", {
          text: "select 1 from habit where id = $1 and deleted_at is null",
          values: [h.id],
        }).should("have.length", 1)
      })
    })
  })

  it("Today rows: complete, reopen and +step reach the server", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Vitamins", type: "check" }).then((c) =>
        seedHabit(user, {
          name: "Water",
          type: "count",
          target: 8,
          unit: "glasses",
          step: 1,
        }).then((n) => {
          signIn(user)
          pulled(/Vitamins/)
          cy.findByRole("checkbox", { name: "Complete Vitamins" }).click()
          liveLog(c.id, TODAY, "and status = 'done'")
          cy.findByRole("button", { name: /Show completed habits/ }).click()
          cy.findByRole("checkbox", { name: "Reopen Vitamins" }).click()
          noLiveLog(c.id, TODAY)

          cy.findByRole("button", { name: "Add 1 glasses" }).click()
          liveLog(n.id, TODAY, "and value = 1")
          cy.findByRole("button", { name: "Add 1 glasses" }).click()
          liveLog(n.id, TODAY, "and value = 2")
          apiUntil<{ data: { value: number }[] }>(
            user,
            `/habits/${n.id}/logs`,
            (b) => b.data.some((l) => l.value === 2),
          )
        }),
      )
    })
  })

  it("Plan → Habits shows server habits and opens the day editor", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Journal", type: "check" }).then((h) => {
        cy.liveApi(user, "POST", `/habits/${h.id}/check`, {})
        signIn(user)
        cy.visit("/plan?seg=habits")
        pulled(/Journal/)
        cy.findByText(/Journal/).should("exist")
        cy.findByRole("button", { name: `Select ${TODAY}` }).should("exist")
        cy.findByText("Edit day").click()
        cy.location("pathname").should("eq", `/habits/day/${TODAY}`)
        cy.findAllByText("1/1").should("have.length.gte", 1)
        cy.findByRole("button", { name: /^(Not yet|Missed)$/ }).click()
        noLiveLog(h.id, TODAY)
        cy.visit("/habits/week")
        cy.findByText(/Journal/).should("exist")
      })
    })
  })

  it("share card and home analytics render the synced habit", () => {
    cy.newLiveUser("habits").then((user) => {
      seedHabit(user, { name: "Run", type: "check" }).then((h) => {
        cy.liveApi(user, "POST", `/habits/${h.id}/check`, {})
        signIn(user)
        cy.visit(`/habits/${h.id}`)
        pulled("Run")
        cy.findByRole("button", { name: "More" }).click()
        cy.findByRole("button", { name: "Share" }).click()
        cy.location("search").should("contain", `habit=${h.id}`)
        cy.findAllByText(/Run/).should("exist")

        cy.visit("/habits")
        cy.findByText(/^ranking$/i).should("exist")
        cy.findAllByText("Run").should("exist")
        cy.findByRole("tab", { name: "7d" }).click()
        cy.findAllByText("100%").should("have.length.gte", 1)
      })
    })
  })
})
