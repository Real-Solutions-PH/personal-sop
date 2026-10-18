import { beforeAll, expect, mock, test } from "bun:test";
import { emit, FROZEN_NOW, freeze } from "./harness";

// weather.ts imports native modules only for its store and device lookup;
// the pure scoring/parsing functions under test never touch them.
mock.module("expo-location", () => ({}));
mock.module("react-native", () => ({ AppState: {}, Platform: { OS: "ios" } }));
const ICONS = [
	"Cloud",
	"CloudDrizzle",
	"CloudFog",
	"CloudLightning",
	"CloudMoon",
	"CloudMoonRain",
	"CloudRain",
	"CloudSnow",
	"CloudSun",
	"CloudSunRain",
	"Moon",
	"Snowflake",
	"Sun",
];
mock.module("lucide-react-native", () =>
	Object.fromEntries(ICONS.map((name) => [name, () => null])),
);
mock.module("zustand", () => ({ create: () => () => ({}) }));
mock.module("@domain/lib/store", () => ({
	createStore: () => ({ get: () => ({}), set: () => {}, use: () => ({}) }),
}));

beforeAll(freeze);

// A synthetic Open-Meteo payload: 3 days, Manila offset, hours chosen so the
// grid crosses every penalty threshold (rain 30, storm 95, heat 31, cold 8,
// UV 6, wind 30) and every advice branch.
function payload(variant: number) {
	const hours: string[] = [];
	const start = Date.parse("2026-10-17T16:00:00Z"); // 00:00 Manila on 10-18
	for (let i = 0; i < 72; i++)
		hours.push(
			new Date(start + i * 3600_000 + 8 * 3600_000).toISOString().slice(0, 16),
		);
	const col = (f: (i: number) => number) => hours.map((_, i) => f(i));
	const v = variant;
	return {
		utc_offset_seconds: 28800,
		current: {
			time: "2026-10-18T12:00",
			temperature_2m: 31,
			apparent_temperature: 36,
			weather_code: 2,
			precipitation: 0,
			wind_speed_10m: 12,
			uv_index: 9,
			relative_humidity_2m: 70,
			is_day: 1,
		},
		hourly: {
			time: hours,
			temperature_2m: col((i) => 24 + ((i * 7 + v) % 12)),
			apparent_temperature: col((i) => [5, 9, 28, 31, 35, 41, 30][(i + v) % 7]),
			precipitation_probability: col(
				(i) => [0, 10, 29, 30, 49, 50, 80][(i * 3 + v) % 7],
			),
			precipitation: col((i) => [0, 0.2, 0.3, 0.5, 2, 6][(i + 2 * v) % 6]),
			weather_code: col((i) => [0, 2, 3, 51, 61, 80, 95, 3][(i * 5 + v) % 8]),
			wind_speed_10m: col((i) => [5, 29, 30, 41, 12][(i + v) % 5]),
			uv_index: col((i) => [0, 3, 5, 6, 8, 11][(i * 2 + v) % 6]),
			relative_humidity_2m: col(() => 70),
			is_day: col((i) => (i % 24 >= 6 && i % 24 < 18 ? 1 : 0)),
		},
		daily: {
			time: ["2026-10-18", "2026-10-19", "2026-10-20"],
			weather_code: [2, 61, 95],
			temperature_2m_max: [33, 31, 30],
			temperature_2m_min: [25, 24, 24],
			apparent_temperature_max: [39, 35, 34],
			precipitation_probability_max: [40, 80, 90],
			precipitation_sum: [1.2, 12, 20],
			uv_index_max: [10, 7, 4],
			wind_speed_10m_max: [20, 35, 45],
			sunrise: ["2026-10-18T05:51", "2026-10-19T05:51", "2026-10-20T05:52"],
			sunset: ["2026-10-18T17:39", "2026-10-19T17:38", "2026-10-20T17:38"],
		},
	};
}

// Dry days that reach the non-rain advice branches: heat, UV, wind, a good
// window, and "fair" (every hour under 70 with no single strong issue).
const DRY: Record<string, { feels: number; uv: number; wind: number }> = {
	heat: { feels: 37, uv: 5, wind: 10 },
	uv: { feels: 30, uv: 9, wind: 10 },
	wind: { feels: 30, uv: 4, wind: 45 },
	window: { feels: 28, uv: 3, wind: 10 },
	fair: { feels: 34, uv: 7, wind: 10 },
};
function dry(kind: string) {
	const base = payload(0);
	const n = base.hourly.time.length;
	const k = DRY[kind];
	return {
		...base,
		hourly: {
			...base.hourly,
			apparent_temperature: Array(n).fill(k.feels),
			precipitation_probability: Array(n).fill(0),
			precipitation: Array(n).fill(0),
			weather_code: Array(n).fill(1),
			wind_speed_10m: Array(n).fill(k.wind),
			uv_index: Array(n).fill(k.uv),
		},
	};
}

test("weather scoring, plan and advice", async () => {
	const W = await import("../../mobile/src/prototype/weather");
	const place = { name: "Manila", lat: 14.5995, lon: 120.9842 };
	const now = Date.parse(FROZEN_NOW);
	const cases = [];
	const payloads = [];
	const inputs = [0, 1, 2, 3, 4, 5, 6].map(payload);
	for (const kind of Object.keys(DRY)) inputs.push(dry(kind) as never);
	for (let v = 0; v < inputs.length; v++) {
		const json = inputs[v];
		payloads.push(json);
		const f = W.parseForecast(json as never, place, now);
		for (const at of [now, now + 7 * 3600_000, now + 11 * 3600_000]) {
			cases.push({
				variant: v,
				now: at,
				scored: f.hourly.map((h) => {
					const s = W.scoreHour(h);
					return { score: s.score, issues: s.issues };
				}),
				plan: W.outdoorPlan(f, at),
				advice: {
					c: W.outdoorAdvice(f, "c", at),
					f: W.outdoorAdvice(f, "f", at),
				},
				rainSoon: W.rainSoon(f, at),
				current: W.currentConditions(f, at),
			});
		}
	}
	const fmt = {
		hours: [0, 1, 11, 12, 13, 23, 24, -1].map((h) => [h, W.fmtHour(h)]),
		ranges: [
			[9, 13],
			[6, 10],
			[12, 15],
			[22, 2],
		].map(([a, b]) => [a, b, W.fmtRange(a, b)]),
		temps: [
			[30.5, "c"],
			[30.4, "f"],
			[-2.5, "c"],
		].map(([t, u]) => [t, u, W.fmtTemp(t as number, u as "c")]),
	};
	expect(cases.length).toBe(36);
	emit("weather-logic", { payloads, cases, fmt });
});
