import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

beforeAll(freeze);

// Amounts stay in pesos exactly as the prototype computes them; the Python
// tests multiply by 100 (centavos). Days are the prototype's own business-day
// keys (`recDay`), so the Python side never re-derives them.

test("finance calculations over the 90-day seed", async () => {
	const C = await import("../../shared/prototype/finance/calc");
	const R = await import("../../shared/prototype/finance/reports");
	const V = await import("../../shared/prototype/finance/review");
	const { buildSeed } = await import("../../shared/prototype/finance/data");
	type S = ReturnType<typeof buildSeed>["state"];
	type P = S["planned"][number];

	const { state: s, statements } = buildSeed();
	const t = C.today();
	const d = (n: number) => C.addDays(t, n);
	const flow = (f: ReturnType<typeof C.flowIn>) => ({
		income: f.income,
		spend: f.spend,
		byCat: Object.fromEntries(f.byCat),
		byPayee: Object.fromEntries(f.byPayee),
		count: f.count,
	});
	const view = (v: ReturnType<typeof C.budgetView>) => ({
		budget: v.b.id,
		spent: v.spent,
		limit: v.limit,
		pct: v.pct,
		pace: v.pace,
		daysLeft: v.daysLeft,
		safePerDay: v.safePerDay,
		from: v.from,
		to: v.to,
	});
	const proj = (p: ReturnType<typeof C.project>) => ({
		start: p.start,
		months: p.months,
		avgUnplanned: p.avgUnplanned,
		low: p.low,
		lowBase: p.lowBase,
		avgSurplus: p.avgSurplus,
		hasIncome: p.hasIncome,
		recoveryMonths: p.recoveryMonths,
	});

	const seed = {
		today: t,
		accounts: s.accounts,
		categories: s.categories,
		records: s.records.map((r) => ({ ...r, day: C.recDay(r) })),
		budgets: s.budgets,
		planned: s.planned,
		settings: s.settings,
		statements,
	};

	const ranges: [string, string][] = [
		[d(-29), t],
		[d(-6), t],
		[d(-89), t],
		[d(-59), d(-30)],
		[t, t],
		...[-3, -2, -1, 0].map((i) =>
			C.monthRange(C.addMonths(C.monthOf(t, 1), i), 1),
		),
	];
	const flows = ranges.map(([f, to]) => ({
		from: f,
		to,
		flow: flow(C.flowIn(s, f, to)),
		savingsRate: C.savingsRate(C.flowIn(s, f, to)),
		noSpend: C.noSpendDays(s, f, to),
		spendAll: C.spendIn(s, f, to, null),
		spendFood: C.spendIn(s, f, to, ["food"]),
	}));

	const budgets = s.budgets.flatMap((b) =>
		[-2, -1, 0].map((i) => {
			const mk = C.addMonths(C.monthOf(t, 1), i);
			const v = C.budgetView(s, b, mk);
			return {
				month: mk,
				view: view(v),
				allowance0: C.todayAllowance(v, 0),
				allowance500: C.todayAllowance(v, 500),
			};
		}),
	);
	const avgSpend = [null, ["food"], ["transport"]].map((ids) => ({
		ids,
		avg: C.avgSpend(s, ids),
	}));
	// A custom month start day changes every period.
	const s5: S = { ...s, settings: { ...s.settings, monthStartDay: 5 } };
	const budgetsSd5 = s.budgets.map((b) => view(C.budgetView(s5, b)));
	const monthKeys = [
		"2026-01-04",
		"2026-01-05",
		"2026-03-01",
		"2026-12-31",
	].map((k) => ({
		day: k,
		sd1: C.monthOf(k, 1),
		sd5: C.monthOf(k, 5),
		range5: C.monthRange(C.monthOf(k, 5), 5),
		range28: C.monthRange(C.monthOf(k, 28), 28),
	}));

	const base = s.planned[0];
	const synth = (over: Partial<P>): P => ({ ...base, ...over }) as P;
	const synthetic: P[] = [
		synth({
			id: "sx-m31",
			schedule: { kind: "monthly", day: 31 },
			start: "2026-01-10",
		}),
		synth({
			id: "sx-semi",
			schedule: { kind: "semimonthly", days: [15, 30] },
			start: "2026-01-01",
		}),
		synth({
			id: "sx-w1",
			schedule: { kind: "weekly", every: 1, anchor: "2026-09-02" },
			start: "2026-09-02",
		}),
		synth({
			id: "sx-w2",
			schedule: { kind: "weekly", every: 2, anchor: "2026-08-30" },
			start: "2026-08-01",
		}),
		synth({
			id: "sx-enddate",
			schedule: { kind: "monthly", day: 8 },
			start: "2026-06-01",
			end: { kind: "date", date: "2026-11-08" },
		}),
		synth({
			id: "sx-count",
			schedule: { kind: "monthly", day: 8 },
			start: "2026-06-09",
			end: { kind: "count", n: 4 },
		}),
		synth({ id: "sx-once", schedule: { kind: "once", date: "2026-11-02" } }),
	];
	const windows: [string, string][] = [
		["2026-01-01", "2026-03-31"],
		["2026-09-01", "2026-12-31"],
		["2026-10-18", "2026-10-18"],
		["2027-01-01", "2027-02-28"],
	];
	const occurrences = [...s.planned, ...synthetic].flatMap((p) =>
		windows.map(([f, to]) => ({
			id: p.id,
			from: f,
			to,
			days: C.occurrences(p, f, to),
		})),
	);
	const monthlyEq = [...s.planned, ...synthetic].map((p) => ({
		id: p.id,
		eq: C.monthlyEq(p),
	}));
	const occRow = (o: ReturnType<typeof C.occurrencesIn>[number]) => ({
		id: o.item.id,
		day: o.day,
		orig: o.orig,
		status: o.status,
		recordId: o.recordId ?? null,
	});
	// Skips and snoozes on the seed's own items.
	const cur0 = C.monthRange(C.monthOf(t, 1), 1)[0];
	const sOcc: S = {
		...s,
		planned: s.planned.map((p) =>
			p.id === "pl-smart"
				? { ...p, skipped: [`${cur0.slice(0, 8)}25`] }
				: p.id === "pl-meralco"
					? { ...p, snoozed: { [`${cur0.slice(0, 8)}20`]: d(8) } }
					: p,
		),
	};
	const occurrencesIn = {
		plain: C.occurrencesIn(s, d(-30), d(30)).map(occRow),
		whatIf: C.occurrencesIn(s, d(-30), d(220), { includeWhatIf: true }).map(
			occRow,
		),
		edited: C.occurrencesIn(sOcc, d(-30), d(30)).map(occRow),
		editedPlanned: sOcc.planned
			.filter((p) => p.skipped.length || Object.keys(p.snoozed).length)
			.map((p) => ({ id: p.id, skipped: p.skipped, snoozed: p.snoozed })),
		dueNow: C.dueNow(s).map(occRow),
	};

	const cur = C.monthOf(t, 1);
	const projections = {
		default: proj(C.project(s, { horizon: 12, includeUnplanned: true })),
		noUnplanned: proj(C.project(s, { horizon: 6, includeUnplanned: false })),
		excludedPlanned: proj(
			C.project(s, {
				horizon: 12,
				includeUnplanned: true,
				excludedPlanned: ["pl-rent", "pl-sal2"],
			}),
		),
		excludedAccounts: proj(
			C.project(s, {
				horizon: 12,
				includeUnplanned: true,
				excludedAccounts: ["gcash"],
			}),
		),
		whatIfOnce: proj(
			C.project(s, {
				horizon: 12,
				includeUnplanned: true,
				whatIf: { amount: 45000, month: C.addMonths(cur, 2), installments: 1 },
			}),
		),
		whatIf12: proj(
			C.project(s, {
				horizon: 24,
				includeUnplanned: true,
				whatIf: { amount: 30000, month: C.addMonths(cur, 1), installments: 12 },
			}),
		),
		whatIfNow: proj(
			C.project(s, {
				horizon: 12,
				includeUnplanned: true,
				whatIf: { amount: 200000, month: cur, installments: 1 },
			}),
		),
		extraPlanned: proj(
			C.project(s, {
				horizon: 12,
				includeUnplanned: true,
				extraPlanned: s.planned.filter((p) => p.isWhatIf),
			}),
		),
	};

	const reconcile = (["gcash", "bpi"] as const).map((acct) => {
		const rows = C.reconcile(s, acct, statements[acct], `imp-${acct}`);
		const to = statements[acct][statements[acct].length - 1].date;
		return {
			account: acct,
			importId: `imp-${acct}`,
			rows: rows.map((r) => ({
				payee: r.payee,
				suggestedCategoryId: r.suggestedCategoryId ?? null,
				categoryId: r.categoryId ?? null,
				state: r.state,
				reason: r.reason ?? null,
				matchId: r.matchId ?? null,
				confidence: r.confidence,
				decision: r.decision,
				isTransfer: !!r.isTransfer,
				needsAttention: C.needsAttention(r),
			})),
			closingTo: to,
			closing: C.statementClosing(s, acct, to, rows),
		};
	});
	const raws = [
		"Payment to JOLLIBEE FOODS CORP",
		"Payment to GRABFOOD PH",
		"Payment to SM CINEMA",
		"Bills Payment — MERALCO",
		"Received money from LUMEN STUDIO INC",
		"Send Money to J** D*** C***",
		"Payment to SOME RANDOM store",
		"Received money — NORTHWIND PH (PAYROLL)",
		"INTEREST EARNED",
		"Cash-in via InstaPay from BPI",
	];
	const guess = raws.map((raw) => {
		const g = C.guessPayee(raw);
		return { raw, payee: g.payee, cat: g.cat ?? null };
	});
	const suggest = [
		"Jolli",
		"starbucks",
		"Meralco",
		"",
		"Unknown Shop",
		"grab",
	].map((payee) => ({ payee, cat: C.suggestCategory(s, payee) ?? null }));

	const reports = (["this", "last", "3m"] as const).map((p) => {
		const r = R.reportData(s, p);
		return {
			period: p,
			range: {
				from: r.r.from,
				to: r.r.to,
				prevFrom: r.r.prevFrom,
				prevTo: r.r.prevTo,
			},
			flow: flow(r.flow),
			prev: flow(r.prev),
			byCat: r.byCat,
			payees: r.payees,
			daily: r.daily,
			days: r.days,
			weekdayAvg: r.weekdayAvg,
			months: r.months,
			budgets: r.budgets.map((b) => ({
				id: b.b.id,
				hist: b.hist.map(view),
			})),
			nw: r.nw,
		};
	});
	const reportsSd5 = (["this", "last", "3m"] as const).map((p) => {
		const r = R.periodRange(s5, p);
		return { period: p, ...r };
	});
	const lbRanges: [string, string, string, string][] = (() => {
		const [f1, t1] = C.monthRange(C.addMonths(cur, -1), 1);
		const [f2, t2] = C.monthRange(C.addMonths(cur, -2), 1);
		return [
			[f1, t1, f2, t2],
			[d(-13), d(-7), d(-20), d(-14)],
		];
	})();
	const lookbacks = lbRanges.map(([f, to, pf, pt]) => {
		const x = V.lookback(s, f, to, pf, pt);
		return {
			from: f,
			to,
			prevFrom: pf,
			prevTo: pt,
			flow: flow(x.flow),
			base: x.base,
			rate: x.rate,
			prevRate: x.prevRate,
			noSpend: { count: x.ns.count, streak: x.ns.streak },
			budgets: x.budgets.map(view),
			kept: x.kept.map((v) => v.b.id),
			blown: x.blown.map((v) => v.b.id),
			where: x.where.map((w) => [w.id, w.v, w.prev]),
			spikes: x.spikes.map((w) => w.id),
			big: x.big.map((r) => r.id),
			leaks: x.leaks.map(([payee, v]) => ({ payee, ...v })),
			subs: x.subs,
			completeness: x.completeness,
			topShare: x.topShare,
		};
	});

	const bal = C.balances(s);
	const accts = Object.fromEntries(
		s.accounts.map((a) => [
			a.id,
			{
				balanceOf: C.balanceOf(s, a),
				balanceOfMinus10: C.balanceOf(s, a, d(-10)),
				series60: C.accountSeries(s, a, 60),
			},
		]),
	);
	// Runway and the stats area rate, as finance/index.ts computes them.
	const p1 = C.project(s, { horizon: 1, includeUnplanned: false });
	let spend3 = 0;
	for (let i = 1; i <= 3; i++) {
		const [f, to] = C.monthRange(C.addMonths(cur, -i), 1);
		spend3 += C.flowIn(s, f, to).spend;
	}
	const views = s.budgets
		.filter((b) => !b.archived)
		.map((b) => C.budgetView(s, b));
	const budgetScore = views.length
		? views.filter((v) => v.pct <= Math.max(v.pace + 0.1, 0.1) && v.pct <= 1)
				.length / views.length
		: 0.5;
	const areaRate = (days: number) => {
		const sr = C.savingsRate(C.flowIn(s, d(-(Math.max(days, 30) - 1)), t));
		const clamp = (v: number) => Math.max(0, Math.min(1, v));
		return Math.round((0.6 * clamp(sr / 0.3) + 0.4 * budgetScore) * 100) / 100;
	};

	// Boundary grid for reconcile: amount tolerance max(₱30, 10%), the ±1 day
	// exact window and the ±3 day probable window, on a bare account.
	const rec = (id: string, amount: number, day: string) => ({
		id,
		type: "expense" as const,
		amount,
		accountId: "acc",
		at: `${day}T04:00:00.000Z`,
		source: "manual" as const,
		status: "cleared" as const,
		day,
	});
	const boundaryRecords = [
		rec("b1", 100, "2026-10-01"),
		rec("b2", 100, "2026-10-03"),
		rec("b3", 1000, "2026-10-05"),
		rec("b4", 1000, "2026-10-07"),
		rec("b5", 200, "2026-10-09"),
		rec("b6", 200, "2026-10-11"),
		rec("b7", 500, "2026-10-13"),
		rec("b8", 500, "2026-10-15"),
	];
	const row = (ref: string, date: string, amount: number) => ({
		ref,
		date,
		time: "12:00",
		raw: `Payment to SHOP ${ref}`,
		amount,
		direction: "out" as const,
	});
	const boundaryRows = [
		row("x1", "2026-10-01", 125), // +25 ≤ 30 → probable
		row("x2", "2026-10-03", 131), // +31 > 30 → new
		row("x3", "2026-10-05", 1099), // +99 ≤ 10% → probable
		row("x4", "2026-10-07", 1101), // +101 ≤ max(30, 110.1) → probable
		row("x5", "2026-10-10", 200), // exact, 1 day → matched
		row("x6", "2026-10-13", 200), // exact, 2 days → probable (date)
		row("x7", "2026-10-16", 500), // exact, 1 day from b8 → matched
		row("x8", "2026-10-19", 500), // b8 claimed, 4 days → new
	];
	const sB: S = {
		...s,
		accounts: [{ ...s.accounts[0], id: "acc", opening: 0 }],
		records: boundaryRecords as unknown as S["records"],
	};
	const boundaryReconcile = C.reconcile(sB, "acc", boundaryRows, "imp-b").map(
		(r) => ({
			state: r.state,
			matchId: r.matchId ?? null,
			reason: r.reason ?? null,
		}),
	);
	// Occurrence statuses around today: yesterday overdue, today and
	// tomorrow due, the day after upcoming.
	const statusPlans: P[] = [-1, 0, 1, 2].map((n) =>
		synth({
			id: `st${n}`,
			schedule: { kind: "monthly", day: Number(d(n).slice(8)) },
			start: "2026-01-01",
		}),
	);
	const sStatus: S = { ...s, planned: statusPlans, records: [] };
	const statusRows = C.occurrencesIn(sStatus, d(-3), d(3)).map(occRow);

	expect(s.records.length).toBeGreaterThan(200);
	emit("finance-calc", {
		seed,
		balances: bal,
		netWorth: C.netWorth(s),
		liquid: C.liquid(s),
		liquidNoGcash: C.liquid(s, bal, ["gcash"]),
		netWorthSeries: C.netWorthSeries(s, 90),
		accounts: accts,
		flows,
		budgets,
		budgetsSd5,
		avgSpend,
		monthKeys,
		occurrences,
		monthlyEq,
		occurrencesIn,
		avgUnplanned: C.avgUnplanned(s),
		projections,
		reconcile,
		boundary: {
			records: boundaryRecords,
			rows: boundaryRows,
			reconcile: boundaryReconcile,
			statusPlans: statusPlans.map((p) => ({ id: p.id, schedule: p.schedule })),
			statusRows,
		},
		guess,
		suggest,
		reports,
		reportsSd5,
		lookbacks,
		stats: {
			runway: spend3 ? p1.start / (spend3 / 3) : 0,
			budgetScore,
			areaRate7: areaRate(7),
			areaRate30: areaRate(30),
			areaRate90: areaRate(90),
		},
	});
});
