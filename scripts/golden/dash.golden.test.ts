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
	const levels = [0, 39, 40, 54, 55, 64, 65, 74, 75, 84, 85, 100].map((s) => ({
		score: s,
		level: levelFor(s).name,
	}));
	expect(cases.length).toBeGreaterThan(50);
	emit("dash-life-score", { cases, levels });
});
