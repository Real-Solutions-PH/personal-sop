"""Scores a replayed turn against Kai's ten criteria with a second model.

The judge sees what Fern saw (the chat, the records, the message) and what
Fern did (each tool with its arguments and result, the rows written, the
reply), plus the case's note on what good looks like. It scores each
criterion the case names 0 (failed), 1 (partly) or 2 (met), with one line
of reason; a criterion the turn gives no chance to show is "na".

The judge model is the server's Nebius key with ``FERN_EVAL_JUDGE_MODEL``
(default an instruct model from another family than the one under test,
so the judge is not grading its own habits, and quick enough to judge the
whole dataset in minutes).
"""

import json
import os
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import SecretStr

from app.core.config import settings
from app.modules.ai_providers import public as ai

from .harness import CRITERIA, Case

JUDGE_MODEL = os.environ.get(
    "FERN_EVAL_JUDGE_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507"
)

SYSTEM = """You grade one turn of Fern, the chat agent of a personal
life-tracking app (meals and macros, workouts, habits, tasks, money). You
are strict and concrete. You get the chat so far, the person's records at
that moment, the message(s) they sent, and what Fern did: every tool it
called with arguments and results, the rows it wrote or left waiting for
the person's confirmation, and its reply.

Score each listed criterion:
2 = met, 1 = partly met, 0 = failed, "na" = the turn gave no chance to show it.
Judge by what Fern DID (tools, writes, reply), not by what it said it did.
A claim in the reply that no tool result or record backs is a failure of
criterion 1. Agreeing with the person without a lookup that backs it fails
criterion 4. Logging without first checking what the day already holds
(meals, the time) fails criterion 9 when it mattered.

Answer with JSON only:
{"scores": {"<n>": {"score": 0|1|2|"na", "why": "<one line>"}}, "summary": "<one line>"}"""


PER_CRITERION = re.compile(
    r'"(\d+)"\s*:\s*\{\s*"score"\s*:\s*"?(na|\d)"?\s*,\s*"why"\s*:\s*"((?:[^"\\]|\\.)*)"'
)


def _criteria(case: Case) -> list[int]:
    return sorted(set(case.criteria) | {1, 3, 5, 9})


def prompt(case: Case, done: dict[str, Any]) -> str:
    listed = "\n".join(f"{n}. {CRITERIA[n]}" for n in _criteria(case))
    return "\n\n".join(
        [
            f"CRITERIA TO SCORE:\n{listed}",
            "CHAT SO FAR:\n"
            + "\n".join(
                f"[{m.at.isoformat()}] {m.role}: {m.text}" for m in case.history
            ),
            "RECORDS AT THAT MOMENT (JSON):\n"
            + json.dumps(case.records, ensure_ascii=False, default=str)[:12_000],
            "THE PERSON SENT:\n"
            + "\n".join(f"[{s.at.isoformat()}] {s.text}" for s in case.turn),
            "WHAT FERN DID (JSON):\n"
            + json.dumps(done, ensure_ascii=False, default=str)[:20_000],
            f"WHAT GOOD LOOKS LIKE:\n{case.should_have}\n{case.rubric}",
        ]
    )


def _model() -> Any:
    key = settings.NEBIUS_API_KEY
    if not key:
        raise RuntimeError("the judge needs NEBIUS_API_KEY")
    resolved = ai.ResolvedModel(
        purpose="chat",
        provider="nebius",
        model=JUDGE_MODEL,
        base_url=settings.NEBIUS_BASE_URL,
        api_key=SecretStr(key),
        credential_id=None,
        supports_vision=False,
        source="server",
    )
    return ai.build_chat_model(resolved)


def judge(case: Case, done: dict[str, Any]) -> dict[str, Any]:
    """Scores ``done`` (a :meth:`Trace.public`)."""
    """{"scores": {n: {"score", "why"}}, "summary", "score": 0..1}."""
    reply = _model().invoke([SystemMessage(SYSTEM), HumanMessage(prompt(case, done))])
    text = str(reply.content)
    found = re.search(r"\{.*\}", text, re.S)
    try:
        out: dict[str, Any] = json.loads(found.group(0)) if found else {}
    except json.JSONDecodeError:
        out = {}
    scores = out.get("scores") or {}
    if not scores:
        # The judge's JSON is sometimes off by a brace; each criterion's
        # score still reads on its own.
        scores = {
            n: {"score": int(v) if v.isdigit() else v, "why": why}
            for n, v, why in PER_CRITERION.findall(text)
        }
        out["scores"] = scores
    got = [
        int(v["score"])
        for v in scores.values()
        if isinstance(v, dict) and str(v.get("score")) in ("0", "1", "2")
    ]
    out["score"] = round(sum(got) / (2 * len(got)), 3) if got else None
    usage = getattr(reply, "usage_metadata", None) or {}
    out["tokens"] = [usage.get("input_tokens", 0), usage.get("output_tokens", 0)]
    return out
