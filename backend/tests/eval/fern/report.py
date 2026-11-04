"""The score table from a replay run's results (``FERN_EVAL_OUT``).

    uv run python -m tests.eval.fern.report [OUT_DIR ...] [--judge] [--baseline]

One directory prints the per-criterion and per-case tables as Markdown;
several print one comparison row per directory (an architecture each).
``--judge`` first scores every result not yet judged (eight at a time,
with ``judge.JUDGE_MODEL``); ``--baseline`` writes ``baseline.json`` (which cases passed) from the one
directory given: the gate the CI job holds later runs to.
"""

import json
import sys
from pathlib import Path
from statistics import mean
from typing import Any

from .harness import CASES, CRITERIA, load_cases

HERE = Path(__file__).parent
DEFAULT_OUT = HERE.parents[2] / "fern-eval-out"


def load(out: Path) -> list[dict[str, Any]]:
    return [json.loads(p.read_text()) for p in sorted(out.glob("*.json"))]


def public_only(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The results of the public cases: ``baseline.json`` and the gate count
    these alone, so private cases (ADR-0034) never move the bar."""
    ids = {p.stem for p in CASES.glob("*.json")}
    return [r for r in results if r["id"] in ids]


def _judged(r: dict[str, Any]) -> dict[int, float]:
    """criterion -> score in 0..1 from the first run's judge."""
    scores = (r["runs"][0].get("judge") or {}).get("scores") or {}
    out: dict[int, float] = {}
    for k, v in scores.items():
        if isinstance(v, dict) and str(v.get("score")) in ("0", "1", "2"):
            out[int(k)] = int(v["score"]) / 2
    return out


def summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    runs = [r["runs"][0] for r in results]
    traces = [x["trace"] for x in runs]
    per: dict[int, list[float]] = {n: [] for n in CRITERIA}
    for r in results:
        for n, s in _judged(r).items():
            per.setdefault(n, []).append(s)
    checks = [c for x in runs for c in x["checks"]]
    fails = [r for r in results if r["kind"] == "failure"]
    guards = [r for r in results if r["kind"] == "guard"]
    judge = [s for x in runs if (s := (x.get("judge") or {}).get("score")) is not None]
    return {
        "cases": len(results),
        "failures_fixed": sum(r["passed"] for r in fails),
        "failures": len(fails),
        "guards_kept": sum(r["passed"] for r in guards),
        "guards": len(guards),
        "checks_passed": sum(c["ok"] for c in checks),
        "checks": len(checks),
        "judge": round(mean(judge), 3) if judge else None,
        "per_criterion": {n: (round(mean(v), 3), len(v)) for n, v in per.items() if v},
        "errors": sum(1 for t in traces if t.get("error")),
        "seconds_mean": round(mean(t["seconds"] for t in traces), 1),
        "turn_seconds_mean": round(
            mean(x for t in traces for x in t.get("turn_seconds") or [t["seconds"]]), 1
        ),
        "turn_seconds_p90": round(
            sorted(x for t in traces for x in t.get("turn_seconds") or [t["seconds"]])[
                int(sum(len(t.get("turn_seconds") or [1]) for t in traces) * 0.9) - 1
            ],
            1,
        ),
        "tools_per_round": round(
            mean([r for t in traces for r in t.get("rounds") or [] if r] or [0]), 2
        ),
        "rounds_mean": round(mean(len(t.get("rounds") or []) for t in traces), 2),
        "seconds_p90": round(
            sorted(t["seconds"] for t in traces)[int(len(traces) * 0.9) - 1], 1
        ),
        "input_tokens_mean": round(mean(t["input_tokens"] for t in traces)),
        "output_tokens_mean": round(mean(t["output_tokens"] for t in traces)),
        "model_calls_mean": round(mean(t["model_calls"] for t in traces), 2),
        "cost_minor_total": sum(t["cost_minor"] for t in traces),
    }


def one(out: Path) -> str:
    results = load(out)
    s = summary(results)
    lines = [
        f"## {out.name}: {s['cases']} cases",
        "",
        f"- Failure cases now passing their checks: {s['failures_fixed']} / {s['failures']}",
        f"- Guard cases still passing: {s['guards_kept']} / {s['guards']}",
        f"- Checks passed: {s['checks_passed']} / {s['checks']}; judge mean {s['judge']}",
        f"- Per turn: {s['seconds_mean']} s mean ({s['seconds_p90']} s p90), "
        f"{s['model_calls_mean']} model calls, {s['input_tokens_mean']:,} in / "
        f"{s['output_tokens_mean']:,} out tokens; total cost {s['cost_minor_total']:,} minor units",
        "",
        "| # | Criterion | Judge score | Cases |",
        "|---|---|---|---|",
    ]
    for n, (v, k) in sorted(s["per_criterion"].items()):
        lines.append(f"| {n} | {CRITERIA[n]} | {v:.2f} | {k} |")
    lines += [
        "",
        "| Case | Kind | Criteria | Checks | Judge | Failed checks |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(results, key=lambda r: r["id"]):
        x = r["runs"][0]
        bad = [c["name"] for c in x["checks"] if not c["ok"]]
        ok = sum(c["ok"] for c in x["checks"])
        lines.append(
            f"| {r['id']} | {r['kind']} | {','.join(map(str, r['criteria']))} | "
            f"{ok}/{len(x['checks'])} | {(x.get('judge') or {}).get('score')} | "
            f"{'; '.join(bad)[:120]} |"
        )
    return "\n".join(lines)


def compare(outs: list[Path]) -> str:
    rows = [(o.name, summary(load(o))) for o in outs]
    crit = sorted({n for _, s in rows for n in s["per_criterion"]})
    head = (
        "| Arch | Failures fixed | Guards kept | Checks | Judge | "
        + " | ".join(f"C{n}" for n in crit)
        + " | s/turn | p90 | rounds | tools/round | calls | tokens in | cost |"
    )
    lines = [head, "|" + "---|" * (head.count("|") - 1)]
    for name, s in rows:
        lines.append(
            f"| {name} | {s['failures_fixed']}/{s['failures']} | {s['guards_kept']}/{s['guards']} | "
            f"{s['checks_passed']}/{s['checks']} | {s['judge']} | "
            + " | ".join(f"{s['per_criterion'].get(n, (None,))[0]}" for n in crit)
            + f" | {s['turn_seconds_mean']} | {s['turn_seconds_p90']} | {s['rounds_mean']} | "
            f"{s['tools_per_round']} | {s['model_calls_mean']} | {s['input_tokens_mean']:,} | "
            f"{s['cost_minor_total']:,} |"
        )
    return "\n".join(lines)


def judge_all(out: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from .judge import JUDGE_MODEL, judge

    cases = {c.id: c for c in load_cases()}

    def one_file(p: Path) -> None:
        r = json.loads(p.read_text())
        run = r["runs"][0]
        done = run.get("judge") or {}
        if done.get("score") is not None and r.get("judge_model") == JUDGE_MODEL:
            return
        if r["id"] not in cases:
            return
        try:
            run["judge"] = judge(cases[r["id"]], run["trace"])
        except Exception as exc:  # noqa: BLE001 - one failed call is one unscored case
            run["judge"] = {"error": type(exc).__name__}
        r["judge_model"] = JUDGE_MODEL
        p.write_text(json.dumps(r, ensure_ascii=False, indent=1, default=str))

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one_file, sorted(out.glob("*.json"))))


def main(argv: list[str]) -> None:
    write_baseline = "--baseline" in argv
    outs = [Path(a) for a in argv if not a.startswith("--")] or [DEFAULT_OUT]
    if "--judge" in argv:
        for o in outs:
            judge_all(o)
    path = HERE / "baseline.json"
    if write_baseline:
        s = summary(public_only(load(outs[0])))
        kept = json.loads(path.read_text()) if path.exists() else {}
        path.write_text(
            json.dumps(
                {
                    "failures_passing": s["failures_fixed"],
                    "judge": s["judge"],
                    "margin": kept.get("margin", 10),
                    "judge_margin": kept.get("judge_margin", 0.03),
                },
                indent=1,
            )
            + "\n"
        )
    sys.stdout.write((one(outs[0]) if len(outs) == 1 else compare(outs)) + "\n")
    if "--gate" in argv:
        base = json.loads(path.read_text())
        s = summary(public_only(load(outs[0])))
        low = s["failures_fixed"] < base["failures_passing"] - base["margin"]
        worse = (s["judge"] or 0) < base["judge"] - base["judge_margin"]
        if low or worse:
            sys.stdout.write(
                f"\nGATE FAILED: {s['failures_fixed']} failure cases pass "
                f"(baseline {base['failures_passing']}, margin {base['margin']}); "
                f"judge {s['judge']} (baseline {base['judge']}).\n"
            )
            sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
