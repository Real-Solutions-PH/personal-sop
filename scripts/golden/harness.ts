/**
 * Golden fixtures for the backend tests (ADR-0014).
 *
 * The prototype's TypeScript calculations in `shared/prototype/` are the ratified
 * behaviour. Each `<module>.golden.test.ts` here runs them over the module's
 * deterministic seed at a FROZEN clock and writes the results to
 * `backend/tests/golden/<name>.json`; the Python tests assert against those
 * files, never against values the Python code produced.
 *
 *   TZ=Asia/Manila bun test scripts/golden
 *
 * Fixtures carry `frozenNow` so the Python side runs at the same instant.
 */

import { setSystemTime } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Sunday 2026-10-18 12:00 Asia/Manila. Never change: every fixture keys off it.
export const FROZEN_NOW = "2026-10-18T04:00:00.000Z";

export function freeze(): void {
	if (process.env.TZ !== "Asia/Manila") {
		throw new Error("run with TZ=Asia/Manila: the prototype uses local time");
	}
	setSystemTime(new Date(FROZEN_NOW));
}

const OUT = join(import.meta.dir, "..", "..", "backend", "tests", "golden");

export function emit(name: string, data: unknown): void {
	const file = join(OUT, `${name}.json`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(
		file,
		`${JSON.stringify({ frozenNow: FROZEN_NOW, source: "shared/prototype", data }, null, 2)}\n`,
	);
}
