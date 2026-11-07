// The "What are you working on?" picker's order: open tasks by when they
// are due (overdue and today together first, then upcoming by date, then
// undated), by priority within each date, then active habits. Search keeps
// that order. Expected orders are written out by hand from the fixtures.

import type { Habit } from "@domain/habits/data"
import type { Task } from "@domain/tasks/data"
import { pickerSections } from "../focus-picker"

const TODAY = "2026-11-07"
let n = 0
const task = (title: string, over: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  title,
  listId: null,
  dueDate: null,
  dueTime: null,
  remindAt: null,
  recurrence: null,
  notes: null,
  starred: false,
  status: "open",
  completedAt: null,
  deletedAt: null,
  clearedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  source: "manual",
  parseState: "parsed",
  originalDue: null,
  rescheduleCount: 0,
  order: n,
  ...over,
})
const habit = (name: string, status = "active") =>
  ({ id: `h-${name}`, name, icon: "🌿", status }) as unknown as Habit

const titles = (s: ReturnType<typeof pickerSections>) =>
  s.map((x) => [x.key, x.rows.map((r) => r.label)])

const TASKS = [
  task("Undated high", { priority: "high" }),
  task("Upcoming Tue low", { dueDate: "2026-11-10", priority: "low" }),
  task("Today low", { dueDate: TODAY, priority: "low" }),
  task("Overdue none", { dueDate: "2026-11-01" }),
  task("Upcoming Mon high", { dueDate: "2026-11-09", priority: "high" }),
  task("Today high", { dueDate: TODAY, priority: "high" }),
  task("Overdue medium", { dueDate: "2026-11-05", priority: "medium" }),
  task("Upcoming Tue high", { dueDate: "2026-11-10", priority: "high" }),
  task("Done today", { dueDate: TODAY, status: "done" }),
  task("Undated none"),
]

describe("picker order", () => {
  it("puts overdue and today first by priority, then upcoming by date, then undated, then habits", () => {
    const s = pickerSections(
      TASKS,
      [habit("Read"), habit("Old", "archived")],
      "",
      TODAY,
    )
    expect(titles(s)).toEqual([
      ["today", ["Today high", "Overdue medium", "Today low", "Overdue none"]],
      [
        "upcoming",
        ["Upcoming Mon high", "Upcoming Tue high", "Upcoming Tue low"],
      ],
      ["undated", ["Undated high", "Undated none"]],
      ["habits", ["🌿 Read"]],
    ])
  })

  it("orders overdue before today at the same priority, oldest first", () => {
    const s = pickerSections(
      [
        task("Today", { dueDate: TODAY }),
        task("Two days late", { dueDate: "2026-11-05" }),
        task("Week late", { dueDate: "2026-10-31" }),
      ],
      [],
      "",
      TODAY,
    )
    expect(titles(s)).toEqual([
      ["today", ["Week late", "Two days late", "Today"]],
    ])
  })

  it("keeps the same order when searching and drops empty sections", () => {
    const s = pickerSections(TASKS, [habit("Read")], "high", TODAY)
    expect(titles(s)).toEqual([
      ["today", ["Today high"]],
      ["upcoming", ["Upcoming Mon high", "Upcoming Tue high"]],
      ["undated", ["Undated high"]],
    ])
  })

  it("returns no sections when nothing matches", () => {
    expect(pickerSections(TASKS, [], "zzz", TODAY)).toEqual([])
  })
})
