import { beforeAll, expect, mock, test } from "bun:test";
import { emit, freeze } from "./harness";

// The capture parser reads the habits, tasks, finance and fitness stores. The
// fixture records the slice of each store it reads (the "world") next to what
// the parser and the tier rules produced, so the Python port runs over the
// same world and never re-derives an expected value.
mock.module("react", () => ({
	useMemo: <T>(fn: () => T) => fn(),
	useSyncExternalStore: <T>(_sub: unknown, get: () => T) => get(),
}));

beforeAll(freeze);

// Every intent in the routing table (IA §6), the boundaries of the amount
// reader (k suffix, commas, units that are not money, "$"), Taglish, the
// segmenter's merge rules, and inputs that fall through to info cards.
const INPUTS = [
	"spent 250 on grab",
	"coffee 165 at tims",
	"paid 1500",
	"gastos 150 sa jeep",
	"lunch 320 jollibee",
	"bought shoes 2,499 on shopee",
	"spent 1.5k on groceries at puregold",
	"$20 netflix",
	"paid 20 dollars for spotify",
	"spent 250 on grab yesterday",
	"meralco 2350 paid via bpi",
	"got paid 35k",
	"salary 42,000 to bpi",
	"client paid 8000 gcash",
	"received refund 450",
	"moved 2k from gcash to bpi",
	"transfer 5000 to maya",
	"topped up 500 to gcash from bpi",
	"netflix 549 every 5th",
	"rent 15000 monthly",
	"remind me to pay rent on the 30th",
	"remind me to call mama",
	"buy eggs, milk, rice",
	"buy eggs and bread",
	"call the dentist tomorrow 3pm",
	"email client the deck by friday",
	"todo: renew passport next week",
	"pay rent",
	"done with the report",
	"finished the deck",
	"ran 5k 32 min",
	"jogged 3.5 km in 25 minutes",
	"walked 40 min",
	"biked 1 hour",
	"swam 30 min yesterday",
	"bench 80x5x3",
	"bench 3x5 60, overhead press 3x8 40, row 3x8 55",
	"did legs: squats 3x5 100, leg press 3x10 140",
	"zercher squat 3x5 60",
	"weighed 72.4",
	"weighed 74.9",
	"timbang 160 lbs",
	"72.1 kg",
	"did my meditation",
	"meditated 10 min",
	"read 20 pages",
	"drank 6 glasses",
	"did my stretch",
	"new habit: read 20 min every weekday 9pm",
	"add habit drink water 8 glasses",
	"create a habit floss at 10pm on weekends",
	"started morning routine",
	"start routine",
	"2 eggs and toast for breakfast",
	"lunch adobo with 1 cup rice",
	"had sinigang and rice",
	"ate something nice",
	"kumain ng pancit",
	"journal: shipped the deck early, proud of it. slept at 1am again though",
	"dear diary - tired, long day, spent 300 on grabfood again",
	"how much did I spend on food this month?",
	"what's my bench PR?",
	"how many habits did I do this week?",
	"should I buy this phone on 0% installment for 24,999?",
	"change that to 300",
	"delete the last one",
	"ugh long day",
	"asdf qwerty",
	"ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th",
	"spent 120 on lunch and weighed 72.4",
	"coffee 165 then bench 80x5x3",
	"how much did I spend this week and what's my bench PR?",
	"spent 99 on load; meditated 10 min",
	"I had a long reflective day today. Work was hard, the client changed the scope again and again, and I barely had time to breathe. But I went to the gym anyway and that helped. Grateful for small wins like that one.",
];

const HINTED: [string, string][] = [
	["half rice, 2 pcs chicken adobo", "meal"],
	["250", "expense"],
	["72.4", "weigh-in"],
	["call Mark", "task"],
	["", "journal"],
	["felt calm today", "journal"],
];

const ANSWERS: [string, string][] = [
	["1500", "categoryId"],
	["electricity", "categoryId"],
	["gifts", "categoryId"],
];

test("capture parser, segmenter and tier rules over the prototype seed", async () => {
	const P = await import("../../shared/prototype/capture/parse");
	const D = await import("../../shared/prototype/capture/data");
	const { habitsStore } = await import("../../shared/prototype/habits/store");
	const { tasksStore } = await import("../../shared/prototype/tasks/store");
	const { finStore } = await import("../../shared/prototype/finance/store");
	const { fitStore } = await import("../../shared/prototype/fitness/store");
	const { latestBodyweight } = await import(
		"../../shared/prototype/fitness/calc"
	);
	const { dayKey } = await import("../../shared/prototype/lib/day");

	const fin = finStore.get();
	const world = {
		today: dayKey(),
		habits: habitsStore.get().habits.map((h) => ({
			id: h.id,
			name: h.name,
			type: h.type,
			target: h.target ?? null,
			status: h.status,
		})),
		routines: habitsStore.get().routines.map((r) => ({
			id: r.id,
			name: r.name,
			icon: r.icon,
			status: r.status,
		})),
		tasks: tasksStore
			.get()
			.tasks.filter((t) => t.status === "open")
			.map((t) => ({ id: t.id, title: t.title })),
		accounts: fin.accounts.map((a) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			archived: !!a.archived,
		})),
		categories: fin.categories.map((c) => ({
			id: c.id,
			name: c.name,
			icon: c.icon,
			kind: c.kind,
		})),
		defaultAccount: P.defaultAccount(),
		latestKg: latestBodyweight(fitStore.get()) ?? null,
		recentCats: P.recentExpenseCats(),
		accountOptions: P.accountOptions(),
	};

	const ctx = (hint?: string) => ({
		hint,
		source: "text",
		at: new Date().toISOString(),
	});
	const parse = INPUTS.map((text) => ({
		text,
		segments: P.segment(text),
		drafts: P.parseCapture(text, ctx()),
	}));
	const hinted = HINTED.map(([text, hint]) => ({
		text,
		hint,
		drafts: P.parseCapture(text, ctx(hint)),
	}));
	const voice = [
		"um so today was uh good, like, i finished the deck. you know, proud",
	].map((text) => ({
		text,
		draft: P.journalDraft(text, "voice"),
	}));
	const photo = ["", "half rice and adobo", "chicken inasal"].map((raw) => ({
		raw,
		draft: P.mealDraft(raw, { photo: true, defaultPlate: true }),
	}));
	const amounts = [
		"250",
		"₱1,250.50",
		"php 99",
		"p300",
		"1.5k",
		"12k salary",
		"$20",
		"20 usd",
		"5 min",
		"3x5",
		"80x5",
		"5 km",
		"9am",
		"on the 30th",
		"2 cups",
		"0",
		"no number",
		"72.4",
		"1,000,000",
	].map((s) => ({ s, out: P.parseAmount(s) }));
	const titles = ["read 20 min", "o'neil's gym", "x-ray day"].map((s) => ({
		s,
		out: P.title(s),
	}));

	expect(parse.length).toBe(INPUTS.length);
	emit("capture-parse", {
		world,
		defaultRules: D.DEFAULT_RULES,
		moneyThreshold: 1000,
		parse,
		hinted,
		voice,
		photo,
		amounts,
		titles,
		answers: ANSWERS,
	});
});
