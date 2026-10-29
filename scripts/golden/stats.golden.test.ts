import { beforeAll, expect, mock, test } from "bun:test";
import { emit, freeze } from "./harness";

// The dashboard hooks are React hooks over the four modules' stores. With the
// hooks reduced to plain calls they are pure functions of the stores, so the
// fixture records exactly what the Today / Stats screens computed over the
// prototype's seeds.
mock.module("react", () => ({
	useMemo: <T>(fn: () => T) => fn(),
	useCallback: <T>(fn: T) => fn,
	// useServerStat watches the server cache; the fixtures are local-only.
	useEffect: () => {},
	useSyncExternalStore: <T>(_sub: unknown, get: () => T) => get(),
}));

beforeAll(freeze);

const MODULES = [
	"habits",
	"tasks",
	"fitness",
	"nutrition",
	"focus",
	"finance",
	"screen",
] as const;

// Calendar items reduced to what the on-target series reads.
type Item = { day: string; module: string; done: boolean };
const slim = (items: { day: string; module: string; done?: boolean }[]) =>
	items.map((i) => ({ day: i.day, module: i.module, done: Boolean(i.done) }));

test("day series, on-target stats and streaks", async () => {
	const H = await import("../../shared/prototype/dash/hooks");
	const { dashStore } = await import("../../shared/prototype/dash/store");
	const { moduleByKey } = H;
	const { dayKey, dayOffset } = await import("../../shared/prototype/lib/day");
	const LEN = 730;
	const from = dayOffset(-(LEN - 1));
	const to = dayKey();
	const items: Item[] = [
		...slim(moduleByKey.habits.useCalendar(from, to)),
		...slim(moduleByKey.tasks.useCalendar(from, to)),
	];
	const base = dashStore.get();
	const variants: {
		name: string;
		threshold: number;
		enabled: Record<string, boolean>;
		wrapups: string[];
	}[] = [];
	for (const threshold of [0.5, 0.8, 1])
		for (const off of [null, "habits", "tasks"] as const)
			for (const sealedToday of [false, true]) {
				const enabled = {
					...base.enabled,
					...(off ? { [off]: false } : {}),
				};
				variants.push({
					name: `t${threshold}-${off ?? "all"}-${sealedToday ? "sealed" : "open"}`,
					threshold,
					enabled,
					wrapups: sealedToday ? [to] : [],
				});
			}
	const out: unknown[] = [];
	for (const v of variants) {
		dashStore.set((s) => ({
			...s,
			targetThreshold: v.threshold,
			enabled: v.enabled as typeof s.enabled,
			wrapups: Object.fromEntries(
				v.wrapups.map((d) => [d, { at: "", onTarget: false, done: 0, due: 0 }]),
			),
		}));
		const series = H.useDaySeries(LEN);
		const ranges = Object.fromEntries(
			[7, 30, 90, 365].map((n) => {
				const o = H.useOnTarget(n);
				return [
					String(n),
					{
						rate: o.rate,
						prevRate: o.prevRate,
						onTarget: o.onTarget,
						scored: o.scored,
						current: o.current,
						best: o.best,
						logged: o.logged,
					},
				];
			}),
		);
		// [due, done, onTarget] per day, oldest first, ending today.
		const compact = series.map((d) => [d.due, d.done, d.onTarget]);
		expect(series[series.length - 1].day).toBe(to);
		out.push({ ...v, series: compact, stats: H.onTargetStats(series), ranges });
	}
	dashStore.set(() => base);

	// Hand-made series over the boundaries the seed never reaches.
	const mk = (xs: (boolean | null)[]) =>
		xs.map((onTarget, i) => ({
			day: `2026-01-${String(i + 1).padStart(2, "0")}`,
			due: onTarget === null ? 0 : 2,
			done: onTarget ? 2 : 0,
			onTarget,
		}));
	const shapes: (boolean | null)[][] = [
		[],
		[null, null],
		[true, true, null, true],
		[true, false, true, true, null],
		[false, false],
		[true, null, null, false, true, true, true, null],
		[null, true, true, true, false, true, true, null],
	];
	const grid = shapes.map((xs) => ({
		series: mk(xs),
		stats: H.onTargetStats(mk(xs)),
	}));
	expect(out.length).toBe(18);
	emit("stats-day-series", { today: to, len: LEN, items, variants: out, grid });
});

test("metric book, goals and goalProgress", async () => {
	const H = await import("../../shared/prototype/dash/hooks");
	const { dashStore } = await import("../../shared/prototype/dash/store");
	const pick = (all: Record<string, { key: string; label: string; value: string; delta?: number; goodWhen?: string; shareable: boolean }[]>) =>
		Object.fromEntries(
			MODULES.map((k) => [
				k,
				all[k].map((m) => ({
					key: m.key,
					label: m.label,
					value: m.value,
					delta: m.delta ?? null,
					goodWhen: m.goodWhen ?? null,
					shareable: m.shareable,
				})),
			]),
		);
	const m7 = pick(H.useAllMetrics(7));
	const m30 = pick(H.useAllMetrics(30));
	const m90 = pick(H.useAllMetrics(90));
	const l7 = H.useLifeScore(7);
	const l30 = H.useLifeScore(30);
	const o7 = H.useOnTarget(7);
	const o30 = H.useOnTarget(30);
	const book = H.useMetricBook();
	const goals = H.useGoals().map((g) => ({
		goal: g.goal,
		entry: g.entry ?? null,
		pct: g.pct,
		hit: g.hit,
		current: g.current,
	}));
	const values = Array.from(
		new Set([
			...MODULES.flatMap((k) => [...m7[k], ...m30[k], ...m90[k]].map((m) => m.value)),
			"85%", "1,234", "-3.5 kg", "₱12,400", "3 / 4", "3/4", "1h 20m", "45m",
			"12-day", "—", "", "x", "0.5", "10.25%", "7d", "2h", "-0", "1.2.3",
		]),
	);
	const parse = values.map((v) => ({
		value: v,
		n: H.parseMetric(v),
		unit: H.unitOf(v),
	}));
	const progress: unknown[] = [];
	for (const comparator of ["gte", "lte"] as const)
		for (const target of [0, 1, 4, 25, 75.5])
			for (const current of [null, 0, 0.5, 1, 3, 4, 25, 30, 80, -2]) {
				const g = {
					id: "g",
					metric: "life",
					label: "",
					target,
					unit: "",
					comparator,
					period: "week" as const,
					createdAt: "2026-01-01",
					status: "active" as const,
				};
				progress.push({
					comparator,
					target,
					current,
					...H.goalProgress(g, current),
				});
			}
	const seedGoals = dashStore.get().goals;
	emit("stats-goals", {
		metrics: { "7": m7, "30": m30, "90": m90 },
		life: {
			"7": { score: l7.score, rates: l7.rates, prevRates: l7.prevRates },
			"30": { score: l30.score, rates: l30.rates, prevRates: l30.prevRates },
		},
		onTarget: { "7": o7.rate, "30": o30.rate },
		book: {
			week: Object.fromEntries(book.week),
			month: Object.fromEntries(book.month),
		},
		seedGoals,
		goals,
		parse,
		progress,
	});
});

test("achievements", async () => {
	const H = await import("../../shared/prototype/dash/hooks");
	const { dashStore } = await import("../../shared/prototype/dash/store");
	const { dayOffset } = await import("../../shared/prototype/lib/day");
	const base = dashStore.get();
	const cases: unknown[] = [];
	const variants: [string, (s: typeof base) => typeof base][] = [
		["seed", (s) => s],
		[
			"wrapups",
			(s) => ({
				...s,
				wrapups: {
					[dayOffset(-3)]: { at: "", onTarget: true, done: 3, due: 3 },
					[dayOffset(0)]: { at: "", onTarget: false, done: 0, due: 4 },
				},
			}),
		],
		[
			"fitness-off",
			(s) => ({ ...s, enabled: { ...s.enabled, fitness: false } }),
		],
		["habits-off", (s) => ({ ...s, enabled: { ...s.enabled, habits: false } })],
		["threshold-half", (s) => ({ ...s, targetThreshold: 0.5 })],
		[
			"goals-hit",
			(s) => ({
				...s,
				goals: s.goals.map((g) => ({ ...g, target: g.comparator === "gte" ? 1 : 99 })),
			}),
		],
	];
	for (const [name, f] of variants) {
		dashStore.set(() => f(base));
		const target = H.useOnTarget(365);
		cases.push({
			name,
			state: {
				enabled: dashStore.get().enabled,
				threshold: dashStore.get().targetThreshold,
				wrapups: Object.keys(dashStore.get().wrapups),
				goals: dashStore.get().goals,
			},
			current: target.current,
			goals: H.useGoals().map((g) => ({
				goal: g.goal,
				entry: g.entry ?? null,
				pct: g.pct,
				hit: g.hit,
			})),
			achievements: H.useAchievements(),
			trophies: H.useTrophies(),
		});
	}
	dashStore.set(() => base);
	expect(cases.length).toBe(6);
	emit("stats-achievements", { cases });
});

test("facets", async () => {
	const { useFacets } = await import("../../shared/prototype/dash/facets");
	const H = await import("../../shared/prototype/dash/hooks");
	const { dashStore } = await import("../../shared/prototype/dash/store");
	const base = dashStore.get();
	const cases: unknown[] = [];
	for (const days of [7, 30])
		for (const off of [
			null,
			"fitness",
			"nutrition",
			"finance",
			"screen",
		] as const) {
			dashStore.set((s) => ({
				...s,
				enabled: { ...s.enabled, ...(off ? { [off]: false } : {}) },
			}));
			const ls = H.useLifeScore(days);
			cases.push({
				days,
				enabled: dashStore.get().enabled,
				rates: ls.rates,
				prevRates: ls.prevRates,
				facets: useFacets(days).map((f) => ({
					...f,
					metricKeys: f.metricKeys ?? null,
					extra: f.extra ?? null,
				})),
			});
		}
	// Screen time with no data: its rate reads 0, the Life Score leaves it
	// out, and its facet is valued 0 but still on.
	const { screenStore } = await import("../../shared/prototype/screen/store");
	const screenBase = screenStore.get();
	screenStore.set(() => ({ groups: [], days: [] }));
	for (const days of [7, 30]) {
		dashStore.set(() => base);
		const ls = H.useLifeScore(days);
		cases.push({
			days,
			enabled: dashStore.get().enabled,
			rates: ls.rates,
			prevRates: ls.prevRates,
			score: ls.score,
			facets: useFacets(days).map((f) => ({
				...f,
				metricKeys: f.metricKeys ?? null,
				extra: f.extra ?? null,
			})),
		});
	}
	screenStore.set(() => screenBase);
	dashStore.set(() => base);
	emit("stats-facets", { cases });
});
