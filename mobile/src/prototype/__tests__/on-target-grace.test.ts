import { onTargetStats } from "@domain/dash/hooks"

const mk = (xs: (boolean | null)[]) =>
  xs.map((onTarget, i) => ({
    day: `2026-11-${String(i + 1).padStart(2, "0")}`,
    due: onTarget === null ? 0 : 2,
    done: onTarget ? 2 : 0,
    onTarget,
  }))

describe("on-target streak grace day", () => {
  it("keeps the streak over one off-target day between hits", () => {
    const s = onTargetStats(mk([true, true, false, true, true]))
    expect(s.current).toBe(4)
    expect(s.best).toBe(4)
    expect(s.graceDays).toEqual(["2026-11-03"])
  })
  it("breaks on two off-target days in a row", () => {
    const s = onTargetStats(mk([true, true, false, false, true]))
    expect(s.current).toBe(1)
    expect(s.graceDays).toEqual([])
  })
  it("treats null days as neutral without using the grace", () => {
    const s = onTargetStats(mk([true, null, null, true, false, true]))
    expect(s.current).toBe(3)
    expect(s.graceDays).toEqual(["2026-11-05"])
  })
  it("holds the grace when the last scored day is off target", () => {
    const s = onTargetStats(mk([true, true, false]))
    expect(s.current).toBe(2)
    expect(s.graceDays).toEqual(["2026-11-03"])
  })
})

describe("walkRun milestones", () => {
  it("reports each run length as it is reached, through a grace day", () => {
    const { walkRun } = require("@domain/lib/grace")
    const hits: [string, number][] = []
    walkRun(
      [
        ["2026-11-01", true],
        ["2026-11-02", true],
        ["2026-11-03", false],
        ["2026-11-04", true],
      ],
      (day: string, run: number) => hits.push([day, run]),
    )
    expect(hits).toEqual([
      ["2026-11-01", 1],
      ["2026-11-02", 2],
      ["2026-11-04", 3],
    ])
  })
})
