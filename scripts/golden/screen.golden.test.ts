import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

// Screen time (spec 2026-10-29-screen-time-design): the rung ladder, the
// day score over a grid of used x budget, and the area rate over hand-built
// day sets. The Python port (backend/app/modules/screen/logic.py) replays the
// same inputs from this file.
beforeAll(freeze);

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const Z = "00000000-0000-4000-8000-0000000000a3"; // budget 0: never scored
const GROUPS = [
	{ id: A, name: "Social", kind: "custom" as const, budgetMin: 60, sortOrder: 0 },
	{ id: B, name: "Games", kind: "custom" as const, budgetMin: 30, sortOrder: 1 },
	{ id: Z, name: "All", kind: "all" as const, budgetMin: 0, sortOrder: 2 },
];

type Row = [day: string, groupId: string, usedMin: number, closed: boolean];
const AREA_CASES: { name: string; rows: Row[] }[] = [
	{ name: "empty", rows: [] },
	{ name: "only-open", rows: [["2026-10-17", A, 30, false]] },
	{ name: "only-zero-budget", rows: [["2026-10-17", Z, 500, true]] },
	{
		name: "one-day-two-groups",
		rows: [
			["2026-10-17", A, 90, true],
			["2026-10-17", B, 30, true],
			["2026-10-17", Z, 999, true],
		],
	},
	{
		name: "week-mixed",
		rows: [
			["2026-10-11", A, 15, true],
			["2026-10-12", A, 75, true],
			["2026-10-12", B, 45, true],
			["2026-10-13", B, 105, true],
			["2026-10-14", A, 240, true],
			["2026-10-15", A, 60, true],
			["2026-10-16", Z, 120, true],
			["2026-10-17", A, 10, false],
		],
	},
	{
		name: "unknown-group-and-open-rows",
		rows: [
			["2026-10-15", "00000000-0000-4000-8000-0000000000ff", 0, true],
			["2026-10-15", A, 70, true],
			["2026-10-15", B, 300, false],
			["2026-10-16", B, 40, true],
		],
	},
];

test("screen time cases", async () => {
	const L = await import("../../shared/prototype/screen/logic");
	const dayScore: { used: number; budget: number; score: number }[] = [];
	for (const budget of [0, 30, 60, 120])
		for (let used = 0; used <= 600; used += 15)
			dayScore.push({ used, budget, score: L.dayScore(used, budget) });
	const areaRate = AREA_CASES.map((c) => ({
		...c,
		rate: L.areaRate(
			c.rows.map(([day, groupId, usedMin, closed]) => ({
				id: `${groupId}-${day}`,
				groupId,
				day,
				usedMin,
				closed,
				updatedAt: "2026-10-18T04:00:00.000Z",
			})),
			GROUPS,
		),
	}));
	expect(areaRate.length).toBe(6);
	emit("screen-logic", {
		standardRungs: L.STANDARD_RUNGS,
		groups: GROUPS,
		dayScore,
		areaRate,
	});
});
