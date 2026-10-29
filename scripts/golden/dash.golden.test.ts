import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

beforeAll(freeze);

test("life score + levels", async () => {
	const { lifeScoreOf, levelFor } = await import(
		"../../shared/prototype/dash/hooks"
	);
	const enabledAll = {
		habits: true,
		tasks: true,
		fitness: true,
		finance: true,
	};
	const defaults = { habits: 3, tasks: 2, fitness: 3, finance: 2 };
	// A grid of rate vectors so rounding and clamping boundaries are covered.
	const grid = [0, 0.25, 0.5, 0.625, 0.75, 1, 1.4, -0.2];
	const cases: unknown[] = [];
	for (const h of grid)
		for (const f of [0, 0.5, 1])
			for (const off of [null, "tasks", "finance"] as const) {
				const rates = { habits: h, tasks: 0.6, fitness: f, finance: 0.33 };
				const enabled = { ...enabledAll, ...(off ? { [off]: false } : {}) };
				const score = lifeScoreOf(rates, defaults, enabled);
				cases.push({
					rates,
					weights: defaults,
					enabled,
					score,
					level: levelFor(score).name,
				});
			}
	const zero = { habits: 0, tasks: 0, fitness: 0, finance: 0 };
	cases.push({
		rates: zero,
		weights: zero,
		enabled: enabledAll,
		score: lifeScoreOf(zero, zero, enabledAll),
		level: levelFor(null).name,
	});
	// Screen time: on with weight 2 like Focus; an unrated area (null in the
	// fixture, `rated` false here) is left out rather than counted as 0.
	const all7 = {
		habits: true,
		tasks: true,
		fitness: true,
		nutrition: true,
		focus: true,
		finance: true,
		screen: true,
	};
	const w7 = { habits: 3, tasks: 2, fitness: 3, nutrition: 2, focus: 2, finance: 2, screen: 2 };
	for (const screen of [null, 0, 0.4, 1])
		for (const off of [null, "screen", "finance"] as const) {
			const rates = {
				habits: 0.8,
				tasks: 0.6,
				fitness: 0.5,
				nutrition: 0.7,
				focus: 0.3,
				finance: 0.33,
				screen: screen ?? 0,
			};
			const enabled = { ...all7, ...(off ? { [off]: false } : {}) };
			const rated = Object.fromEntries(
				Object.keys(all7).map((k) => [k, k !== "screen" || screen !== null]),
			) as Record<keyof typeof all7, boolean>;
			const score = lifeScoreOf(rates, w7, enabled, rated);
			cases.push({
				rates: { ...rates, screen },
				weights: w7,
				enabled,
				score,
				level: levelFor(score).name,
			});
		}
	const levels = [0, 39, 40, 54, 55, 64, 65, 74, 75, 84, 85, 100].map((s) => ({
		score: s,
		level: levelFor(s).name,
	}));
	expect(cases.length).toBeGreaterThan(50);
	emit("dash-life-score", { cases, levels });
});
