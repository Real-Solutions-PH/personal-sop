"""Compare replay runs of several chat models: accuracy, latency and cost.

    uv run python -m tests.eval.fern.model_compare OUT_DIR [OUT_DIR ...] [--json]

Each OUT_DIR is one ``test_fern_replay`` run (``FERN_EVAL_OUT``) of one
model, over the same cases. Prints Markdown tables (docs/28-fern-model-choice.md
quotes them): accuracy, latency per message, tokens and cost per message,
and pass rate by topic.

Latency is per message the person sent (a case may send a burst of several):
``first_event_s`` is send-to-first-thing-on-screen (thinking, text or a tool
card), ``first_text_s`` send-to-first-word-of-the-reply, ``turn_seconds``
send-to-reply-finished, tool rounds included.

Cost is recomputed from the run's tokens with ``PRICES`` (USD per million
tokens), not taken from ``cost_minor``: the app prices a model it does not
list at a generic fallback rate. "Cached" uses the cache reads the provider
reported; for Anthropic every uncached input token is billed as a cache
write (automatic caching writes the new tail of every call), so that column
is an upper bound. "Uncached" bills every input token at the base rate.
"""

import json
import sys
from pathlib import Path
from statistics import mean, median, quantiles
from typing import Any

# USD per million tokens: (input, cache read, cache write, output).
# Nebius: GET https://api.tokenfactory.nebius.com/v1/models?verbose=true,
# 2026-11-12 (Nebius caches on its own and bills no cache write).
# Anthropic: the claude-api skill's model table (cached 2026-11-03), with the
# cache read/write rates OpenRouter lists for the same models on 2026-11-12
# (0.1x and 1.25x of input).
PRICES: dict[str, tuple[float, float, float, float]] = {
    "deepseek-ai/DeepSeek-V4.1-Flash-1017": (0.30, 0.006, 0.30, 1.20),
    "MiniMaxAI/MiniMax-M3.1-Flash": (0.15, 0.015, 0.15, 0.60),
    "openai/gpt-oss-120b": (0.15, 0.10, 0.15, 0.60),
    "anthropic/claude-haiku-5.5": (0.10, 0.01, 0.125, 0.50),
    "anthropic/claude-sonnet-5.5": (2.00, 0.10, 2.50, 10.00),
}

TOPICS: list[tuple[str, tuple[str, ...]]] = [
    ("meal", ("log_meal", "meal", "food", "macro", "kcal", "protein", "label")),
    ("task", ("create_tasks", "task", "remind")),
    ("habit", ("habit", "routine")),
    (
        "money",
        ("expense", "account", "balance", "income", "planned", "transfer", "bill", "₱"),
    ),
]


def topic(r: dict[str, Any]) -> str:
    text = (r.get("title") or "").casefold()
    for name, words in TOPICS:
        if any(w.casefold() in text for w in words):
            return name
    return "other"


def _pct(xs: list[float], q: int) -> float:
    if not xs:
        return float("nan")
    if len(xs) == 1:
        return xs[0]
    return quantiles(xs, n=100, method="inclusive")[q - 1]


def summarise(out: Path) -> dict[str, Any]:
    results = [json.loads(p.read_text()) for p in sorted(out.glob("*.json"))]
    model = results[0]["model"] if results else out.name
    p_in, p_read, p_write, p_out = PRICES.get(model, (0, 0, 0, 0))
    first_ev: list[float] = []
    first_tx: list[float] = []
    turn_s: list[float] = []
    call_s: list[float] = []
    msgs = calls = tin = tout = tread = 0
    checks_ok = checks_n = errors = cut = empty = 0
    judge: list[float] = []
    topics: dict[str, list[int]] = {}
    for r in results:
        run = r["runs"][0]
        t = run["trace"]
        n = max(1, len(t.get("turn_seconds") or []))
        msgs += n
        first_ev += [x for x in t.get("first_event_s") or [] if x is not None]
        first_tx += [x for x in t.get("first_text_s") or [] if x is not None]
        turn_s += t.get("turn_seconds") or []
        call_s += t.get("call_seconds") or []
        calls += t["model_calls"]
        tin += t["input_tokens"]
        tout += t["output_tokens"]
        tread += t.get("cache_read_tokens") or 0
        checks_ok += sum(c["ok"] for c in run["checks"])
        checks_n += len(run["checks"])
        errors += bool(t.get("error"))
        cut += t.get("cut_off") or 0
        empty += not any((x or "").strip() for x in t.get("replies") or [])
        scores = ((run.get("judge") or {}).get("scores")) or {}
        vals = [
            int(v["score"]) / 2
            for v in scores.values()
            if isinstance(v, dict) and str(v.get("score")) in ("0", "1", "2")
        ]
        if vals:
            judge.append(mean(vals))
        bucket = topics.setdefault(topic(r), [0, 0])
        bucket[0] += bool(r["passed"])
        bucket[1] += 1
    guards = [r for r in results if r["kind"] == "guard"]
    fails = [r for r in results if r["kind"] != "guard"]
    uncached = (tin * p_in + tout * p_out) / 1e6
    cached = ((tin - tread) * p_write + tread * p_read + tout * p_out) / 1e6
    return {
        "dir": out.name,
        "model": model,
        "cases": len(results),
        "messages": msgs,
        "passed": sum(r["passed"] for r in results),
        "guards_kept": f"{sum(r['passed'] for r in guards)}/{len(guards)}",
        "failures_fixed": f"{sum(r['passed'] for r in fails)}/{len(fails)}",
        "checks": f"{checks_ok}/{checks_n}",
        "checks_pct": round(100 * checks_ok / max(1, checks_n), 1),
        "judge_mean": round(mean(judge), 3) if judge else None,
        "errors": errors,
        "empty_reply_cases": empty,
        "cut_off_turns": cut,
        "first_event_p50": round(_pct(first_ev, 50), 1),
        "first_event_p90": round(_pct(first_ev, 90), 1),
        "first_text_p50": round(_pct(first_tx, 50), 1),
        "first_text_p90": round(_pct(first_tx, 90), 1),
        "turn_mean": round(mean(turn_s), 1) if turn_s else None,
        "turn_p50": round(_pct(turn_s, 50), 1),
        "turn_p90": round(_pct(turn_s, 90), 1),
        "call_p50": round(median(call_s), 2) if call_s else None,
        "calls_per_msg": round(calls / msgs, 2),
        "in_per_msg": round(tin / msgs),
        "out_per_msg": round(tout / msgs),
        "cache_read_share": round(tread / max(1, tin), 3),
        "usd_per_msg_cached": round(cached / msgs, 5),
        "usd_per_msg_uncached": round(uncached / msgs, 5),
        "topics": {k: f"{v[0]}/{v[1]}" for k, v in sorted(topics.items())},
    }


def table(rows: list[dict[str, Any]], cols: list[str]) -> str:
    head = "| " + " | ".join(["model", *cols]) + " |"
    sep = "|" + "---|" * (len(cols) + 1)
    body = [
        "| " + " | ".join([r["dir"], *[str(r[c]) for c in cols]]) + " |" for r in rows
    ]
    return "\n".join([head, sep, *body])


def _out(text: str) -> None:
    sys.stdout.write(text + "\n")


def main(argv: list[str]) -> None:
    dirs = [Path(a) for a in argv if not a.startswith("--")]
    rows = [summarise(d) for d in dirs]
    if "--json" in argv:
        _out(json.dumps(rows, indent=1))
        return
    _out("### Accuracy\n")
    _out(
        table(
            rows,
            [
                "cases",
                "passed",
                "guards_kept",
                "failures_fixed",
                "checks",
                "judge_mean",
                "errors",
                "empty_reply_cases",
                "cut_off_turns",
            ],
        )
    )
    _out("\n### Latency per message (seconds)\n")
    _out(
        table(
            rows,
            [
                "first_event_p50",
                "first_event_p90",
                "first_text_p50",
                "first_text_p90",
                "turn_mean",
                "turn_p50",
                "turn_p90",
                "calls_per_msg",
                "call_p50",
            ],
        )
    )
    _out("\n### Tokens and cost per message\n")
    _out(
        table(
            rows,
            [
                "in_per_msg",
                "out_per_msg",
                "cache_read_share",
                "usd_per_msg_cached",
                "usd_per_msg_uncached",
            ],
        )
    )
    _out("\n### Cases passed by topic\n")
    names = sorted({k for r in rows for k in r["topics"]})
    _out(table([{**r, **r["topics"]} for r in rows], names))


if __name__ == "__main__":
    main(sys.argv[1:])
