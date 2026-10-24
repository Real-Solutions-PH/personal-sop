import { beforeAll, expect, test } from "bun:test";
import { emit, freeze } from "./harness";

// The focus timer (ADR-0025): each case starts a session, applies actions at
// given minutes and reads the timeline at probe minutes. The Python port
// (backend/app/modules/focus/logic.py) replays the same cases from this file.
beforeAll(freeze);

const T0 = Date.parse("2026-10-20T01:00:00.000Z"); // 09:00 in Manila
const MIN = 60_000;
const SID = "00000000-0000-4000-8000-000000000009";
const TASK = { kind: "task" as const, id: "00000000-0000-4000-8000-000000000001", title: "Write" };
const HABIT = { kind: "habit" as const, id: "00000000-0000-4000-8000-000000000002", title: "Read" };

type Act =
	| ["pause" | "resume" | "next" | "skip" | "stop" | "abandon" | "tick", number]
	| ["switch", number, "task" | "habit" | null]
	| ["extend", number, number];
interface Case {
	name: string;
	mode: "pomodoro" | "stopwatch";
	lengths: [number, number, number, number];
	autoBreaks: boolean;
	autoFocus: boolean;
	startMin: number;
	acts: Act[];
	probes: number[];
}
const CASES: Case[] = [
	{ name: "auto-breaks", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [], probes: [10, 26, 31, 45] },
	{ name: "auto-everything", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: true, startMin: 0, acts: [], probes: [61, 200, 2000] },
	{ name: "manual", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: false, autoFocus: false, startMin: 0, acts: [["next", 30], ["next", 40]], probes: [26, 36, 41] },
	{ name: "pause", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["pause", 10], ["resume", 15]], probes: [12, 20, 31] },
	{ name: "pause-in-break", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["pause", 27], ["resume", 40]], probes: [30, 41, 44] },
	{ name: "switch", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["switch", 10, "habit"], ["pause", 12], ["switch", 13, null], ["resume", 14]], probes: [20, 27] },
	{ name: "extend", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["extend", 20, 300]], probes: [26, 31, 36] },
	{ name: "skip-break", mode: "pomodoro", lengths: [50, 10, 20, 3], autoBreaks: true, autoFocus: true, startMin: 0, acts: [["skip", 52], ["skip", 103]], probes: [104, 400] },
	{ name: "stop-early", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["stop", 12]], probes: [13] },
	{ name: "tap", mode: "pomodoro", lengths: [25, 5, 15, 4], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["stop", 0.5]], probes: [1] },
	{ name: "abandon", mode: "pomodoro", lengths: [90, 20, 30, 2], autoBreaks: true, autoFocus: false, startMin: 0, acts: [["abandon", 40]], probes: [41] },
	{ name: "stopwatch", mode: "stopwatch", lengths: [25, 5, 15, 4], autoBreaks: false, autoFocus: false, startMin: 0, acts: [], probes: [180, 780] },
	{ name: "stopwatch-pause-left", mode: "stopwatch", lengths: [25, 5, 15, 4], autoBreaks: false, autoFocus: false, startMin: 0, acts: [["pause", 30]], probes: [60, 2880] },
	// Starts 03:30 in Manila on the 21st: the 04:00 rollover is at 30 min.
	{ name: "day-boundary", mode: "stopwatch", lengths: [25, 5, 15, 4], autoBreaks: false, autoFocus: false, startMin: 18 * 60 + 30, acts: [["stop", 18 * 60 + 90]], probes: [18 * 60 + 91] },
];

test("focus timeline cases", async () => {
	const L = await import("../../shared/prototype/focus/logic");
	const out: unknown[] = [];
	for (const c of CASES) {
		let n = 100;
		const newId = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
		let tl = L.start({
			sessionId: SID,
			segmentId: newId(),
			mode: c.mode,
			lengths: c.lengths,
			autoStartBreaks: c.autoBreaks,
			autoStartFocus: c.autoFocus,
			item: TASK,
			now: T0 + c.startMin * MIN,
		});
		const at = (m: number) => T0 + m * MIN;
		const probes: unknown[] = [];
		const read = (m: number) => {
			const now = at(m);
			const a = L.advance(tl, now);
			const p = L.phase(a, now);
			const spans = L.counted([a], now);
			probes.push({
				min: m,
				segs: a.segs.map((s) => ({
					id: s.id,
					kind: s.kind,
					set: s.setIndex,
					start: s.start,
					end: s.end,
					planned: s.plannedSec,
					item: s.item?.id ?? null,
				})),
				ended: a.sess.end,
				reason: a.sess.endReason,
				phase: {
					status: p.status,
					kind: p.kind,
					set: p.setIndex,
					planned: p.plannedSec,
					elapsed: p.elapsed,
					remaining: p.remaining,
					longBreak: p.longBreak,
					endsAt: p.endsAt,
					item: p.item?.id ?? null,
				},
				focusSec: L.focusSec(a, now),
				sets: L.setsCompleted(a, now),
				perDay: L.perDay(spans, "2026-10-19", "2026-10-22"),
				perItem: L.perItem(spans),
			});
		};
		const acts = [...c.acts];
		const probesLeft = [...c.probes];
		while (acts.length || probesLeft.length) {
			const nextAct = acts[0]?.[1] ?? Number.POSITIVE_INFINITY;
			const nextProbe = probesLeft[0] ?? Number.POSITIVE_INFINITY;
			if (nextProbe < nextAct) {
				read(probesLeft.shift() as number);
				continue;
			}
			const a = acts.shift() as Act;
			const now = at(a[1]);
			if (a[0] === "pause") tl = L.pause(tl, now, newId);
			else if (a[0] === "resume") tl = L.resume(tl, now, newId);
			else if (a[0] === "next") tl = L.startNext(tl, now, newId);
			else if (a[0] === "skip") tl = L.skipBreak(tl, now, newId);
			else if (a[0] === "stop") tl = L.stop(tl, now);
			else if (a[0] === "abandon") tl = L.stop(tl, now, true);
			else if (a[0] === "tick") tl = L.advance(tl, now);
			else if (a[0] === "extend") tl = L.extend(tl, now, a[2]);
			else
				tl = L.switchItem(
					tl,
					now,
					a[2] === "habit" ? HABIT : a[2] === "task" ? TASK : null,
					newId,
				);
		}
		out.push({ ...c, probes });
	}
	expect(out.length).toBe(CASES.length);
	emit("focus-logic", { t0: T0, sessionId: SID, task: TASK, habit: HABIT, cases: out });
});
