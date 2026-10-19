import { beforeAll, expect, mock, test } from "bun:test";
import { emit, freeze } from "./harness";

// Sol's deterministic router (mobile/src/prototype/companion/brain.ts) over
// a grid of messages: every intent branch, the tracker goal/direction
// reader, the day-range reader, and fall-through to capture. `Math.random`
// is pinned to 0 so `pick` always takes the first phrasing (the server's
// choice too). Trackers and memories the router records are captured from
// the store after each message.
let n = 0;
mock.module("@domain/lib/store", () => ({
	uid: () => `id-${++n}`,
	createStore: <T>(_key: string, seed: () => T) => {
		let state = seed();
		return {
			get: () => state,
			set: (fn: (s: T) => T) => {
				state = fn(state);
			},
			use: () => state,
		};
	},
}));
mock.module("zustand", () => ({
	create: () => Object.assign(() => ({}), { setState: () => {} }),
}));
const sent: unknown[] = [];
mock.module("@domain/capture/actions", () => ({
	sendCapture: (x: unknown) => sent.push(x),
}));
mock.module("@domain/dash/store", () => ({
	dashStore: { get: () => ({ profile: { name: "Kai Tecson" } }) },
}));

beforeAll(() => {
	freeze();
	Math.random = () => 0;
});

const INPUTS = [
	"hi",
	"Good morning Sol",
	"kumusta",
	"thanks!",
	"salamat po",
	"I'm so tired today",
	"feeling overwhelmed and burnt out",
	"can't focus",
	"remember that I'm training for a 10K",
	"Remember my sister's birthday is May 3.",
	"what do you know about me?",
	"track my spending under 1,500",
	"keep an eye on my weight",
	"alert me if workouts go above 4",
	"monitor tasks",
	"show my spending this week",
	"chart my workouts",
	"graph my weight over the last 90 days",
	"compare habits this year",
	"show me today",
	"plan my day",
	"what should i do next?",
	"coach me",
	"give me honest feedback",
	"how am I doing?",
	"any patterns lately",
	"who are you",
	"help",
	"spent 250 on grab",
	"how much did I spend on food this month?",
	"weighed 72.4",
];

test("Sol's router over the grid", async () => {
	const B = await import("../../mobile/src/prototype/companion/brain");
	const S = await import("../../mobile/src/prototype/companion/store");
	const cases = INPUTS.map((text) => {
		const before = S.companionStore.get();
		const route = B.route(text);
		const after = S.companionStore.get();
		return {
			text,
			route,
			trackers: after.trackers.map(({ id: _id, createdAt: _c, ...t }) => t),
			trackerChanged: after.trackers !== before.trackers,
			memories: after.memories.map((m) => m.text),
		};
	});
	const labels = (
		[
			"life",
			"habits",
			"tasks",
			"spend",
			"spendCats",
			"netWorth",
			"workouts",
			"weight",
			"nutrition",
		] as const
	).map((m) => ({ metric: m, label: B.metricLabel(m) }));
	expect(cases.length).toBe(INPUTS.length);
	emit("companion-brain", {
		seed: {
			name: "Sol",
			trackers: [
				{ metric: "spend", label: "Daily spending", goal: 1500, direction: "below" },
			],
			memories: [
				"Training for a 10K before December",
				"Paying off the BPI card in full every month",
			],
		},
		profileName: "Kai Tecson",
		cases,
		labels,
	});
});
