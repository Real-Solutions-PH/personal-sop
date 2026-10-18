import { beforeAll, expect, mock, test } from "bun:test";
import { emit, freeze } from "./harness";

// The module contract and the Today data are React hooks over the store. With
// the hooks reduced to plain calls they are pure functions of the store, so
// the fixture records exactly what the screens computed.
mock.module("react", () => ({
	useMemo: <T>(fn: () => T) => fn(),
	useSyncExternalStore: <T>(_sub: unknown, get: () => T) => get(),
}));

beforeAll(freeze);

type Rule =
	| { kind: "daily" }
	| { kind: "weekdays" }
	| { kind: "weekly"; days: number[] }
	| { kind: "monthly"; day: number }
	| { kind: "everyN"; n: number };

const RULES: Rule[] = [
	{ kind: "daily" },
	{ kind: "weekdays" },
	{ kind: "weekly", days: [5] },
	{ kind: "weekly", days: [0, 3] },
	{ kind: "weekly", days: [6] },
	{ kind: "monthly", day: 1 },
	{ kind: "monthly", day: 5 },
	{ kind: "monthly", day: 29 },
	{ kind: "monthly", day: 30 },
	{ kind: "monthly", day: 31 },
	{ kind: "everyN", n: 2 },
	{ kind: "everyN", n: 3 },
	{ kind: "everyN", n: 10 },
];

// Month ends, leap day (2028), a non-leap February, year end, a Friday, a
// Saturday (weekdays rule), and the frozen today.
const DUES = [
	"2026-01-31",
	"2026-02-28",
	"2027-02-28",
	"2028-02-28",
	"2028-02-29",
	"2026-04-30",
	"2026-10-16",
	"2026-10-17",
	"2026-10-18",
	"2026-12-31",
];

test("nextDue grid + fmtRepeat", async () => {
	const L = await import("../../shared/prototype/tasks/logic");
	const cases: unknown[] = [];
	for (const rule of RULES)
		for (const mode of ["fixed", "after"] as const)
			for (const due of DUES)
				for (const shift of [-3, 0, 1, 5, 40]) {
					const done = L.addDays(due, shift);
					cases.push({
						rule,
						mode,
						due,
						done,
						next: L.nextDue({ rule, mode }, due, done),
					});
				}
	const repeat = RULES.flatMap((rule) =>
		(["fixed", "after"] as const).map((mode) => ({
			rule,
			mode,
			text: L.fmtRepeat({ rule, mode }),
		})),
	);
	expect(cases.length).toBeGreaterThan(1000);
	emit("tasks-next-due", { cases, repeat });
});

test("seed state, stats, today data, module contract", async () => {
	const L = await import("../../shared/prototype/tasks/logic");
	const { seedTasks } = await import("../../shared/prototype/tasks/data");
	const H = await import("../../shared/prototype/tasks/hooks");
	const { module } = await import("../../shared/prototype/tasks/index");
	const state = seedTasks();
	const tk = L.today();

	const stats: unknown[] = [];
	for (const [days, offset] of [
		[7, 0],
		[7, 7],
		[30, 0],
		[30, 30],
		[90, 0],
		[84, 0],
		[1, 0],
	]) {
		const to = L.addDays(tk, -offset);
		const from = L.addDays(to, -(days - 1));
		for (const countGroceries of [true, false]) {
			const s = L.computeStats(
				{ ...state, settings: { ...state.settings, countGroceries } },
				from,
				to,
				tk,
			);
			stats.push({
				days,
				offset,
				countGroceries,
				from,
				to,
				stats: { ...s, topPushed: s.topPushed.map((t) => t.id) },
			});
		}
	}

	const ids = (ts: { id: string }[]) => ts.map((t) => t.id);
	const d = H.useTodayData();
	const today = {
		overdue: ids(d.overdue),
		due: ids(d.due),
		doneToday: ids(d.doneToday),
		doneDueToday: ids(d.doneDueToday),
		upcoming: d.upcoming.map((u) => ({ day: u.day, tasks: ids(u.tasks) })),
		later: ids(d.later),
		inbox: ids(d.inbox),
		starred: ids(d.starred),
		shoppingOpen: d.shoppingOpen,
		nextReminder: d.nextReminder?.id ?? null,
		everHadTasks: d.everHadTasks,
	};

	const live = state.tasks.filter((t) => t.status !== "deleted");
	const byDue = [...live].sort(L.byDue).map((t) => t.id);
	const overdue = state.tasks.filter((t) => L.isOverdue(t)).map((t) => t.id);
	const now = new Date();
	const dueNow = state.tasks.filter((t) => L.isDueNow(t, now)).map((t) => t.id);
	const dueNowLater = state.tasks
		.filter((t) => L.isDueNow(t, new Date(now.getTime() + 8 * 3600000)))
		.map((t) => t.id);

	const contract = {
		metrics: Object.fromEntries(
			[7, 30, 90].map((n) => [String(n), module.useMetrics(n)]),
		),
		areaRate: Object.fromEntries(
			[
				[7, 0],
				[7, 7],
				[30, 0],
				[1, 0],
			].map(([n, o]) => [`${n}:${o}`, module.useAreaRate(n, o)]),
		),
		calendar: module.useCalendar(L.addDays(tk, -7), L.addDays(tk, 7)),
		misses: module.useMisses(L.addDays(tk, -30), tk),
		todayProgress: module.useTodayProgress(),
	};

	emit("tasks-stats", {
		today: tk,
		state,
		stats,
		todayData: today,
		byDue,
		overdue,
		dueNow,
		dueNowLater,
		contract,
	});
});

test("parse + capture split", async () => {
	const P = await import("../../shared/prototype/tasks/parse");
	const phrases = [
		"dentist fri 10am",
		"call Mark tomorrow 3pm",
		"finish deck for work by Fri",
		"remind me to pay meralco on the 5th every month",
		"pay rent every month on the 31st",
		"water plants every 3 days",
		"standup every weekday at 9:30",
		"gym every monday 6am",
		"laundry every saturday",
		"review weekly",
		"journal daily 21:00",
		"everyday stretch",
		"call mama tonight",
		"dinner tonight 7pm",
		"lunch at noon",
		"buy load mamaya",
		"submit report tmrw 17:45",
		"pay bills bukas",
		"plan trip next week",
		"clean garage this weekend",
		"renew passport in 10 days",
		"renew license in 1 day",
		"birthday gift oct 25",
		"tax filing on apr 15",
		"anniversary jan 3",
		"mid-month check the 15th",
		"rent the 1st",
		"weird date feb 30",
		"invalid nov 45",
		"meeting at 25:00",
		"at 12am snack",
		"12pm call",
		"by",
		"remind me",
		"  ",
		"email client after lunch",
		"Thursday sync",
		"thurs retro",
		"on tue dentist",
		"this sat market",
		"next wed review",
		"deadline sept 30 5pm",
		"pay credit card monthly",
		"monthly report on the 20th",
		"every 14 days backup",
		"weekdays commute log",
	];
	const days = ["2026-10-18", "2026-10-31", "2026-12-30", "2028-02-27"];
	const parse = days.flatMap((tk) =>
		phrases.map((text) => ({ tk, text, parsed: P.parseTask(text, tk) })),
	);
	const captures = [
		"buy eggs and rice, call Mark tomorrow 3pm, finish deck for work by Fri",
		"remind me to pay meralco on the 5th every month",
		"call Mark",
		"email client after lunch",
		"gym bag, protein, laundry detergent",
		"buy milk and bread and call mama later",
		"fix freelance site; send invoice to client\nclean room",
		"pay pldt and book flights and reply to Anna",
		"eggs tomorrow",
		"side job mockups friday, job2 invoice",
		"",
		" , ;",
	];
	const listSets = [
		["work", "job2", "life", "groceries"],
		["work", "life"],
		[],
	];
	const split = captures.flatMap((text) =>
		listSets.map((lists) => ({
			text,
			lists,
			drafts: P.splitCapture(text, "capture-voice", lists),
		})),
	);
	expect(parse.length).toBeGreaterThan(100);
	emit("tasks-parse", { parse, split });
});
