import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

beforeAll(freeze);

// The prototype seed plus a few rows that reach branches the seed never does:
// an archived habit, logs on unscheduled days (bonus), an open-ended pause, a
// future-dated pause and an in-progress routine run from yesterday.
async function state() {
	const { seedHabits } = await import("../../shared/prototype/habits/data");
	const { dayOffset, at } = await import("../../shared/prototype/lib/day");
	const s = seedHabits();
	s.habits.push({
		id: "h-archived",
		name: "Cold shower",
		icon: "🚿",
		type: "count",
		target: 3,
		unit: "min",
		step: 1,
		schedule: [{ days: [1, 3, 5], time: "07:00" }],
		reminder: false,
		status: "archived",
		pauses: [],
		linkWorkout: false,
		createdAt: dayOffset(-40),
		archivedAt: dayOffset(-10),
		sortOrder: 9,
	});
	for (const d of [-39, -36, -30, -20, -12, -11, -9, -5]) {
		s.logs.push({
			id: `x-arch-${d}`,
			habitId: "h-archived",
			day: dayOffset(d),
			status: d % 2 ? "done" : "partial",
			value: d % 2 ? 3 : 1,
			loggedAt: at(d, 7, 20),
			source: "tap",
		});
	}
	// Saturday + Sunday logs on the Mon–Fri "Sleep" habit: bonus days.
	for (const d of [-1, -7, -8]) {
		const day = dayOffset(d);
		if (!s.logs.some((l) => l.habitId === "h-sleep" && l.day === day))
			s.logs.push({
				id: `x-bonus-${d}`,
				habitId: "h-sleep",
				day,
				status: "done",
				loggedAt: at(d, 23, 10),
				source: "tap",
			});
	}
	// The seed's habits share one `pauses` array; replace it, never push.
	const journal = s.habits.find((h) => h.id === "h-journal");
	if (journal)
		journal.pauses = [
			...journal.pauses,
			{ from: dayOffset(-3), reason: "Travel" },
		];
	const read = s.habits.find((h) => h.id === "h-read");
	if (read)
		read.pauses = [...read.pauses, { from: dayOffset(2), to: dayOffset(5) }];
	// On-time boundaries for Meditate (06:45, window 60): -60 and +60 minutes
	// are on time, one minute past either edge is not.
	const onTimeGrid: [number, number, number][] = [
		[-2, 5, 45],
		[-3, 5, 44],
		[-4, 7, 45],
		[-5, 7, 46],
		[-6, 9, 0],
		[-13, 4, 30],
	];
	for (const [d, hh, mm] of onTimeGrid) {
		const day = dayOffset(d);
		const log = s.logs.find((l) => l.habitId === "h-meditate" && l.day === day);
		if (log && log.status !== "skipped") log.loggedAt = at(d, hh, mm);
		else
			s.logs.push({
				id: `x-ontime-${d}`,
				habitId: "h-meditate",
				day,
				status: "done",
				value: 10,
				loggedAt: at(d, hh, mm),
				source: "tap",
			});
	}
	s.runs.push({
		id: "run-stale",
		routineId: "r-winddown",
		day: dayOffset(-1),
		startedAt: at(-1, 22, 5),
		steps: [
			{ habitId: "h-journal", minutes: 10 },
			{ habitId: "h-read", minutes: 25 },
			{ habitId: "h-sleep", minutes: 5 },
		],
		results: [{ habitId: "h-journal", status: "done", actualSec: 640 }],
		current: 1,
		stepStartedAt: at(-1, 22, 16),
		stepPausedSec: 0,
		stepBonusSec: 0,
		state: "in_progress",
	});
	return s;
}

test("habits logic over the seed", async () => {
	const L = await import("../../shared/prototype/habits/logic");
	const { dayKey, dayOffset } = await import("../../shared/prototype/lib/day");
	const s = await state();
	const today = dayKey();
	const idx = L.logIndex(s.logs);

	const cellDays = L.daysBetween(dayOffset(-95), dayOffset(7));
	const cells = Object.fromEntries(
		s.habits.map((h) => [
			h.id,
			cellDays.map((d) => L.cellFor(h, d, idx, today)),
		]),
	);

	const windows = [
		[dayOffset(-6), today],
		[dayOffset(-29), today],
		[dayOffset(-89), today],
		[dayOffset(-60), dayOffset(-31)],
		[dayOffset(-3), dayOffset(4)],
	];
	const habitStats = s.habits.flatMap((h) =>
		windows.map(([from, to]) => ({
			habitId: h.id,
			from,
			to,
			stats: L.habitStats(h, idx, from, to, today),
		})),
	);
	const streaks = s.habits.map((h) => ({
		habitId: h.id,
		...L.streaks(h, idx, today),
	}));

	const overallStats = [7, 30, 90].flatMap((days) =>
		[0, days].map((offset) => ({
			days,
			offset,
			stats: L.overallStats(s, days, offset),
		})),
	);
	// Only the habits already done today: today is a perfect day, and must
	// still not count as one.
	const doneToday = s.habits.filter(
		(h) => L.cellFor(h, today, idx, today) === "done",
	);
	const perfectToday = [1, 7].map((days) => ({
		days,
		habitIds: doneToday.map((h) => h.id),
		stats: L.overallStats({ ...s, habits: doneToday }, days),
	}));
	const active = s.habits.filter((h) => h.status !== "archived");
	const overallDays = L.overallDays(
		active,
		idx,
		dayOffset(-20),
		dayOffset(2),
		today,
	);

	const routineStats = s.routines.flatMap((r) =>
		[7, 30, 60].map((days) => {
			const st = L.routineStats(r, s.runs, days, today);
			return {
				routineId: r.id,
				days,
				scheduledDays: st.scheduledDays,
				completed: st.completed,
				abandoned: st.abandoned.map((x) => x.id),
				runs: st.runs.map((x) => x.id),
				rate: st.rate,
				pace: st.pace,
			};
		}),
	);
	const runStates = s.runs.map((r) => ({
		id: r.id,
		state: L.runState(r, today),
	}));

	const mostMissed = [7, 30, 90].map((n) => ({
		from: dayOffset(-n + 1),
		result: L.mostMissedWeekday(active, idx, dayOffset(-n + 1), today),
	}));

	const groupTimes = [
		"2026-10-18T03:30:00+08:00",
		"2026-10-18T05:29:00+08:00",
		"2026-10-18T05:30:00+08:00",
		"2026-10-18T06:14:00+08:00",
		"2026-10-18T08:31:00+08:00",
		"2026-10-18T12:00:00+08:00",
		"2026-10-18T21:00:00+08:00",
		"2026-10-18T23:59:00+08:00",
		"2026-10-19T01:30:00+08:00",
	];
	const partialCheck = {
		id: "x-partial-check",
		habitId: "h-workout",
		day: today,
		status: "partial" as const,
		loggedAt: "2026-10-18T03:00:00.000Z",
		source: "tap" as const,
	};
	const todayGroups = s.habits.flatMap((h) =>
		groupTimes.flatMap((t) => {
			const log = idx.get(L.lk(h.id, today));
			const partial = { ...partialCheck, habitId: h.id, value: 1 };
			return [
				{
					habitId: h.id,
					now: t,
					log: log ? log.status : null,
					group: L.todayGroup(h, log, today, new Date(t)),
				},
				{
					habitId: h.id,
					now: t,
					log: "partial",
					group: L.todayGroup(h, partial, today, new Date(t)),
				},
			];
		}),
	);

	const base = {
		id: "run-x",
		routineId: "r-morning",
		day: today,
		startedAt: "2026-10-18T02:00:00.000Z",
		steps: [],
		results: [],
		current: 0,
		stepBonusSec: 0,
		state: "in_progress" as const,
	};
	const elapsedCases = [
		{
			stepStartedAt: "2026-10-18T03:50:00.000Z",
			stepPausedSec: 0,
			pausedAt: undefined,
			now: "2026-10-18T04:00:00.000Z",
		},
		{
			stepStartedAt: "2026-10-18T03:50:00.000Z",
			stepPausedSec: 125.5,
			pausedAt: undefined,
			now: "2026-10-18T04:00:00.000Z",
		},
		{
			stepStartedAt: "2026-10-18T03:50:00.000Z",
			stepPausedSec: 30,
			pausedAt: "2026-10-18T03:55:00.000Z",
			now: "2026-10-18T04:00:00.000Z",
		},
		{
			stepStartedAt: "2026-10-18T03:50:00.000Z",
			stepPausedSec: 900,
			pausedAt: undefined,
			now: "2026-10-18T04:00:00.000Z",
		},
	].map((c) => ({
		...c,
		elapsed: L.stepElapsed(
			{ ...base, ...c, pausedAt: c.pausedAt },
			new Date(c.now).getTime(),
		),
	}));

	const shuffled = [...s.habits].reverse();
	const sorted = L.sortedHabits(shuffled).map((h) => h.id);

	expect(s.logs.length).toBeGreaterThan(400);
	emit("habits-logic", {
		today,
		state: s,
		cellDays,
		cells,
		habitStats,
		streaks,
		overallStats,
		perfectToday,
		overallDays,
		routineStats,
		runStates,
		mostMissed,
		todayGroups,
		elapsedCases,
		sorted,
	});
});
