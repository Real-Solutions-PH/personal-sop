import { beforeAll, expect, mock, test } from "bun:test";
import { emit, freeze } from "./harness";

mock.module("react", () => ({
	useMemo: <T>(fn: () => T) => fn(),
	useCallback: <T>(fn: T) => fn,
	useSyncExternalStore: <T>(_sub: unknown, get: () => T) => get(),
}));

beforeAll(freeze);

// The static tables the dashboard's write paths validate against: share
// templates and their fields (with defaults), onboarding paces and starter
// goals, plus the goal label every starter resolves to on the seed.
test("share templates, onboarding paces and starters", async () => {
	const SD = await import("../../shared/prototype/dash/share-data");
	const OB = await import("../../shared/prototype/dash/onboarding");
	const H = await import("../../shared/prototype/dash/hooks");
	const fmt = Object.values(OB.STARTERS).map((s) => ({
		metric: s.metric,
		text: H.fmtGoal({
			...s,
			id: "x",
			createdAt: "2026-01-01",
			status: "active",
		}),
	}));
	expect(SD.TEMPLATES.length).toBe(7);
	emit("dashboard-tables", {
		common: SD.COMMON,
		templates: SD.TEMPLATES,
		paces: OB.PACES,
		starters: OB.STARTERS,
		identities: OB.IDENTITIES,
		fmtGoal: fmt,
	});
});
