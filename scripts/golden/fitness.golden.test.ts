import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

beforeAll(freeze);

// A hand-built state for the branches the seed never reaches: reps/time load
// types with history, sets above 12 reps (the e1RM fallback), every set at
// the rep-range max, bodyweight load with and without a weigh-in, and a
// warm-up-only exercise. Timestamps are relative to the frozen clock.
async function miniState() {
	const { at } = await import("../../shared/prototype/lib/day");
	const ex = (
		id: string,
		loadType: string,
		repMin: number,
		repMax: number,
		increment: number,
	) => ({
		id,
		name: id,
		equipment: loadType === "weight" ? "barbell" : "bodyweight",
		muscle: "core",
		loadType,
		repMin,
		repMax,
		increment,
	});
	const set = (
		id: string,
		reps: number,
		weight: number,
		kind = "working",
		done = true,
		atIso?: string,
	) => ({
		id,
		reps,
		weight,
		kind,
		...(done ? { completedAt: atIso ?? at(-3, 18, 30) } : {}),
	});
	const workout = (
		id: string,
		n: number,
		exercises: { id: string; exerciseId: string; sets: unknown[] }[],
		status = "finished",
		templateId?: string,
	) => ({
		id,
		name: id,
		templateId,
		startedAt: at(n, 18, 0),
		endedAt: status === "finished" ? at(n, 19, 5) : undefined,
		status,
		exercises,
		clientId: `c-${id}`,
		source: "live",
	});
	return {
		exercises: [
			ex("maxed", "weight", 5, 8, 2.5),
			ex("highrep", "weight", 12, 20, 1),
			ex("dips", "bodyweight", 6, 10, 2.5),
			ex("situp", "reps", 10, 30, 0),
			ex("hold", "time", 30, 60, 0),
			ex("warmonly", "weight", 8, 12, 2.5),
			ex("fresh", "weight", 8, 12, 2.5),
		],
		templates: [
			{ id: "ta", name: "A", items: [{ exerciseId: "maxed", sets: 3 }] },
			{ id: "tb", name: "B", items: [{ exerciseId: "dips", sets: 2 }] },
		],
		workouts: [
			workout(
				"mw1",
				-30,
				[
					{
						id: "mw1-a",
						exerciseId: "maxed",
						sets: [
							set("a1", 6, 100),
							set("a2", 6, 100),
							set("a3", 5, 100, "drop"),
						],
					},
					{
						id: "mw1-b",
						exerciseId: "highrep",
						sets: [set("b1", 15, 20), set("b2", 13, 20)],
					},
					{
						id: "mw1-c",
						exerciseId: "dips",
						sets: [set("c1", 8, 0), set("c2", 7, 10)],
					},
				],
				"finished",
				"ta",
			),
			workout(
				"mw2",
				-25,
				[
					{
						id: "mw2-a",
						exerciseId: "maxed",
						sets: [set("a4", 8, 100), set("a5", 8, 100), set("a6", 9, 100)],
					},
					{
						id: "mw2-s",
						exerciseId: "situp",
						sets: [set("s1", 20, 0), set("s2", 18, 0)],
					},
					{
						id: "mw2-h",
						exerciseId: "hold",
						sets: [set("h1", 45, 0), set("h2", 40, 0, "failure")],
					},
					{
						id: "mw2-w",
						exerciseId: "warmonly",
						sets: [set("w1", 10, 40, "warmup")],
					},
				],
				"finished",
				"tb",
			),
			workout(
				"mw3",
				-10,
				[
					{
						id: "mw3-a",
						exerciseId: "maxed",
						sets: [
							set("a7", 8, 102.5),
							set("a8", 7, 102.5),
							set("a9", 8, 102.5, "working", false),
						],
					},
					{
						id: "mw3-c",
						exerciseId: "dips",
						sets: [set("c3", 10, 5), set("c4", 9, 5)],
					},
				],
				"finished",
				"ta",
			),
			workout(
				"mw4",
				-4,
				[
					{
						id: "mw4-a",
						exerciseId: "maxed",
						sets: [set("a10", 8, 100), set("a11", 7, 100)],
					},
				],
				"discarded",
			),
		],
		weighIns: [
			{ id: "mwi1", measuredAt: at(-2, 6, 30), weightKg: 80.4 },
			{ id: "mwi2", measuredAt: at(-2, 21, 0), weightKg: 81.0 },
			{ id: "mwi3", measuredAt: at(-1, 7, 0), weightKg: 80.2 },
		],
		targets: [
			{
				id: "mt1",
				effectiveFrom: "2026-10-10",
				kcal: 2000,
				protein: 150,
				carbs: 200,
				fat: 60,
			},
			{
				id: "mt2",
				effectiveFrom: "2026-10-16",
				kcal: 1800,
				protein: 140,
				carbs: 180,
				fat: 55,
			},
		],
		meals: [],
		settings: {
			units: "kg",
			restSec: 90,
			weeklyTarget: 2,
			weighInReminder: "06:30",
			progression: "double",
			aiSource: "builtin",
			goalDirection: "bulk",
		},
		activeId: null,
		rest: null,
	};
}

// Nutrition grid: one day per boundary of the ±10% kcal band, the 110% "over"
// line and the 90% protein line, against a 2000 kcal / 150 g target.
async function nutritionGridState() {
	const { at } = await import("../../shared/prototype/lib/day");
	const kcals: [number, number][] = [
		[1799, 134],
		[1800, 135],
		[1800.5, 134.9],
		[2000, 150],
		[2200, 200],
		[2200.5, 10],
		[2201, 160],
		[0, 0],
	];
	const meals = kcals.map(([kcal, protein], i) => ({
		id: `g${i}`,
		eatenAt: at(-(i + 1), 12, 0),
		label: "lunch",
		source: "manual",
		rawInput: "grid",
		status: "confirmed",
		items: [
			{
				id: `gi${i}`,
				name: "x",
				qty: 1,
				unit: "pc",
				kcal,
				protein,
				carbs: 0,
				fat: 0,
			},
		],
	}));
	// A pending estimate on day -1 must not count toward the totals, and an
	// estimated meal on day -2 must.
	meals.push({
		id: "gp",
		eatenAt: at(-1, 15, 0),
		label: "snack",
		source: "photo",
		rawInput: "Photo",
		status: "pending_estimate",
		items: [
			{
				id: "gpi",
				name: "y",
				qty: 1,
				unit: "pc",
				kcal: 999,
				protein: 99,
				carbs: 0,
				fat: 0,
			},
		],
	});
	meals.push({
		id: "ge",
		eatenAt: at(-2, 3, 30), // before the 04:00 day start: belongs to day -3
		label: "snack",
		source: "text",
		rawInput: "late",
		status: "estimated",
		items: [
			{
				id: "gei",
				name: "z",
				qty: 1,
				unit: "pc",
				kcal: 50,
				protein: 5,
				carbs: 0,
				fat: 0,
			},
		],
	});
	return {
		exercises: [],
		templates: [],
		workouts: [],
		weighIns: [],
		targets: [
			{
				id: "nt1",
				effectiveFrom: "2026-09-01",
				kcal: 2000,
				protein: 150,
				carbs: 200,
				fat: 60,
			},
		],
		meals,
		settings: {
			units: "kg",
			restSec: 120,
			weeklyTarget: 4,
			weighInReminder: "06:30",
			progression: "double",
			aiSource: "builtin",
			goalDirection: "maintain",
		},
		activeId: null,
		rest: null,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: fixtures are plain JSON
async function calcOutputs(s: any) {
	const C = await import("../../shared/prototype/fitness/calc");
	const { dayOffset } = await import("../../shared/prototype/lib/day");
	const exMap = C.exMap(s);
	const bw = C.latestBodyweight(s) ?? 0;
	const exStats = s.workouts.flatMap(
		// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
		(w: any) =>
			// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
			w.exercises.map((we: any) => {
				const st = C.exStats(we, exMap.get(we.exerciseId), bw);
				return {
					workoutId: w.id,
					weId: we.id,
					bestE1rm: st.bestE1rm,
					heaviest: st.heaviest,
					volume: st.volume,
					topSetId: st.top?.id ?? null,
					doneSets: st.doneSets,
				};
			}),
	);
	// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
	const totals = s.workouts.map((w: any) => ({
		workoutId: w.id,
		...C.workoutTotals(s, w),
	}));
	const prs = C.allPrs(s);
	const byWorkout = Object.fromEntries(
		[...C.prsByWorkout(prs).entries()].map(([k, v]) => [
			k,
			v.map((p) => p.kind),
		]),
	);
	const suggestions = Object.fromEntries(
		// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
		s.exercises.map((e: any) => [e.id, C.suggestion(s, e.id)]),
	);
	const linear = { ...s, settings: { ...s.settings, progression: "linear" } };
	const linearSuggestions = Object.fromEntries(
		// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
		s.exercises.map((e: any) => [e.id, C.suggestion(linear, e.id)]),
	);
	const stalled = Object.fromEntries(
		// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
		s.exercises.map((e: any) => [
			e.id,
			C.isStalled(C.exerciseHistory(s, e.id)),
		]),
	);
	const history = Object.fromEntries(
		// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
		s.exercises.map((e: any) => [
			e.id,
			C.exerciseHistory(s, e.id).map((h) => ({
				workoutId: h.workout.id,
				bestE1rm: h.stats.bestE1rm,
			})),
		]),
	);
	const targetDays = [-120, -91, -90, -36, -35, -34, -1, 0].map((n) =>
		dayOffset(n),
	);
	const targetFor = Object.fromEntries(
		targetDays.map((d) => [d, C.targetFor(s, d)?.id ?? null]),
	);
	// The in-progress PR preview: the last finished workout replayed as an
	// unfinished "extra" (counts once more against the history).
	const last = C.finished(s).at(-1);
	const extraPrs = last
		? C.allPrs(s, { ...last, id: "extra", status: "in_progress" })
		: [];
	return {
		latestBodyweight: C.latestBodyweight(s) ?? null,
		exStats,
		workoutTotals: totals,
		allPrs: prs,
		prsByWorkout: byWorkout,
		extraPrs: extraPrs.filter((p) => p.workoutId === "extra"),
		suggestions,
		linearSuggestions,
		stalled,
		history,
		sessionsByWeek: C.sessionsByWeek(s, 20),
		consistencyStreak: C.consistencyStreak(s),
		dailyWeights: Object.fromEntries(C.dailyWeights(s)),
		weightTrend30: C.weightTrend(s, 30),
		weightTrend90: C.weightTrend(s, 90),
		weeklyRate: C.weeklyRate(s) ?? null,
		nutritionDays30: C.nutritionDays(s, 30),
		adherence: [
			[7, 0],
			[7, 7],
			[14, 0],
			[30, 0],
			[30, 30],
			[3, 2],
		].map(([d, o]) => {
			const a = C.adherence(s, d, o);
			return {
				days: d,
				offset: o,
				logged: a.logged,
				calorie: a.calorie,
				protein: a.protein,
				overDays: a.overDays,
				coverage: a.coverage,
			};
		}),
		overloadRate: {
			28: C.overloadRate(s, 28),
			90: C.overloadRate(s, 90),
			7: C.overloadRate(s, 7),
		},
		periodSummary: [
			[7, 0],
			[7, -7],
			[30, 0],
			[30, -30],
			[90, 0],
			[1, 0],
		].map(([d, o]) => ({ days: d, endOffset: o, ...C.periodSummary(s, d, o) })),
		targetFor,
		nextTemplate: C.nextTemplate(s)?.id ?? null,
		dayTotals: Object.fromEntries(
			[0, -1, -2, -3].map((n) => [dayOffset(n), C.dayTotals(s, dayOffset(n))]),
		),
	};
}

test("fitness calc over the prototype seed", async () => {
	const { seed } = await import("../../shared/prototype/fitness/data");
	const { macrosLeftToday } = await import(
		"../../shared/prototype/fitness/actions"
	);
	const s = seed();
	expect(s.workouts.length).toBeGreaterThan(30);
	emit("fitness-seed", s);
	emit("fitness-calc", {
		...(await calcOutputs(s)),
		macrosLeftToday: macrosLeftToday(),
	});
});

test("fitness calc over the edge-case states", async () => {
	const mini = await miniState();
	const grid = await nutritionGridState();
	emit("fitness-mini", { state: mini, calc: await calcOutputs(mini) });
	emit("fitness-nutrition-grid", {
		state: grid,
		calc: await calcOutputs(grid),
	});
});

test("e1rm grid", async () => {
	const C = await import("../../shared/prototype/fitness/calc");
	const cases: unknown[] = [];
	for (const load of [-5, 0, 0.5, 20, 57.5, 100, 102.5, 333.3])
		for (const reps of [-1, 0, 1, 2, 5, 10, 12, 13, 30])
			cases.push({ load, reps, e1rm: C.e1rm(load, reps) });
	const fmt = [0, 1, 2.25, 2.35, 2.5, 10, 57.25, 60.05, 102.5, 9999.95].map(
		(n) => ({
			n,
			kg: C.kg(n),
			kgShort: C.kgShort(n),
		}),
	);
	const vol = [0, 0.5, 999.5, 1234.4, 9999, 9999.5, 10000, 12345, 123456].map(
		(n) => ({
			n,
			fmt: C.fmtVolume(n),
		}),
	);
	emit("fitness-e1rm", { cases, fmt, vol });
});

test("meal estimator", async () => {
	const A = await import("../../shared/prototype/fitness/actions");
	const { fitStore } = await import("../../shared/prototype/fitness/store");
	const inputs = [
		"tapsilog",
		"tapsilog, isang cup na garlic rice",
		"lunch: 1 cup rice, adobo 2 pcs chicken thigh, softdrinks 1 can",
		"breakfast 2 eggs, 2 pandesal, coffee w/ sugar",
		"2 cups rice and sinigang",
		"half rice, tinola",
		"kalahati rice",
		"200g tapa",
		// Gram threshold: above 20 a number is grams, at or below it a count.
		"20 g tapa",
		"21 g tapa",
		"30g tocino",
		"3 x egg",
		"150 g inasal",
		"protein shake",
		"whey and banana",
		"longsilog tocilog",
		"bangsilog",
		"lechon kawali with rice",
		"1.5 cups garlic rice and 2 eggs",
		"0.1 pandesal",
		"dalawang itlog",
		"tatlong banana",
		"sinigang na hipon",
		"shrimp sinigang",
		"pancit canton",
		"pizza",
		"",
		"RICE AND ADOBO",
		"chicken breast 300 g",
		"10 skyflakes",
		"coke",
		"oats with banana and whey",
	];
	const strip = (items: { id: string }[]) =>
		items.map(({ id: _id, ...rest }) => rest);
	const cases = inputs.map((raw) => {
		const r = A.parseMealText(raw);
		return {
			raw,
			result: r
				? {
						items: strip(r.items),
						confidence: r.confidence,
						followUp: r.followUp ?? null,
					}
				: null,
		};
	});
	// Follow-up answers and quantity edits, through the store.
	const base = {
		id: "fm",
		eatenAt: new Date().toISOString(),
		label: "lunch",
		source: "text",
		rawInput: "rice and adobo",
		status: "estimated",
		confidence: 0.76,
		items: [
			{
				id: "r",
				name: "Steamed rice",
				qty: 1,
				unit: "cup",
				kcal: 205,
				protein: 4,
				carbs: 45,
				fat: 0,
				assumption: "~1 cup cooked, 160 g",
			},
			{
				id: "g",
				name: "Garlic rice (sinangag)",
				qty: 1.5,
				unit: "cup",
				kcal: 420,
				protein: 8,
				carbs: 75,
				fat: 9,
			},
			{
				id: "a",
				name: "Chicken adobo (thigh)",
				qty: 2,
				unit: "pc",
				kcal: 380,
				protein: 32,
				carbs: 4,
				fat: 26,
			},
		],
		followUp: {
			question: "How much rice?",
			options: ["1 cup", "1.5 cups", "2 cups"],
		},
	};
	const answers: unknown[] = [];
	for (const [option, confidence] of [
		["1 cup", 0.76],
		["1.5 cups", 0.76],
		["2 cups", 0.9],
		["half", undefined],
		["0.5 cup", 0.5],
	] as const) {
		fitStore.set((s) => ({ ...s, meals: [{ ...base, confidence }] as never }));
		A.answerFollowUp("fm", option);
		const m = fitStore.get().meals[0];
		answers.push({
			option,
			confidenceIn: confidence ?? null,
			confidence: m.confidence,
			items: m.items,
			followUp: m.followUp ?? null,
		});
	}
	const qty: unknown[] = [];
	for (const [itemId, q] of [
		["r", 2],
		["r", 0.5],
		["g", 1],
		["a", 3],
		["a", 0],
		["a", -1],
	] as const) {
		fitStore.set((s) => ({ ...s, meals: [{ ...base }] as never }));
		A.setMealItemQty("fm", itemId, q);
		qty.push({
			itemId,
			qty: q,
			item: fitStore.get().meals[0].items.find((i) => i.id === itemId),
		});
	}
	emit("fitness-meal-estimator", { cases, answers, qty });
	fitStore.reset();
});
