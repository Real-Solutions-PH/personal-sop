"""The finance advisor's AI answer (FIN advisor thread, ADR-0012/0013).

``ask`` stores the question, answers it, and stores the answer as
``advisor_message`` rows:

- with ``resolve_model(ctx, "advisor")`` (and the AI switch and spend cap
  allowing it) a tool-calling agent reads the user's finances through
  :func:`advisor_tools`. What the tools may return follows
  ``finance_settings.ai_scope``: ``aggregates`` shares totals and averages
  only; ``records`` (or a one-off "allow records for this answer") adds
  individual transactions. Every answer carries the disclaimer;
- otherwise (no model, AI off, cap reached, provider down) the
  deterministic :func:`advisor.answer` answers, as on the device.
"""

import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from app.modules.ai_providers import public as ai
from app.modules.capture import public as capture
from app.modules.finance import advisor, calc, repo, services
from app.modules.finance import schema as S
from app.modules.finance.models import AdvisorMessage, AdvisorThread
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

Emit = Callable[[str, dict[str, Any]], None]
Scope = Literal["aggregates", "records"]
HISTORY = 10
MAX_RECORDS = 200


class AskIn(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=2000)]
    id: uuid.UUID | None = None
    # A one-off "Allow records for this answer" (the deterministic answer's
    # action); None follows finance settings.
    scope: Scope | None = None


def _noop(event: str, data: dict[str, Any]) -> None:
    del event, data


def peso(minor: float) -> str:
    v = calc.js_round(minor / 100)
    return f"₱{v:,}" if v >= 0 else f"₱-{-v:,}"


def flatten(paragraphs: list[list[dict[str, Any]]]) -> str:
    """The structured answer's paragraphs as plain text (``m`` exact pesos,
    ``k`` rounded pesos)."""
    out: list[str] = []
    for para in paragraphs:
        parts: list[str] = []
        for seg in para:
            if "t" in seg:
                parts.append(str(seg["t"]))
            elif "m" in seg:
                parts.append(peso(seg["m"]))
            elif "k" in seg:
                parts.append(peso(seg["k"]))
        out.append("".join(parts))
    return "\n\n".join(out)


# ---------------------------------------------------------------- tools


class NoArgs(BaseModel):
    pass


class DaysArgs(BaseModel):
    days: Annotated[int, Field(ge=1, le=366)] = 30


class QuestionArgs(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=500)]


def advisor_tools(
    s: calc.State, scope: Scope, safety_floor_minor: int
) -> list[BaseTool]:
    cats = calc.cat_map(s)

    def summary(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        bal = calc.balances(s)
        base = calc.project(s, horizon=12, include_unplanned=True)
        mk = calc.month_of(s.today, s.settings.month_start_day)
        spend = income = 0
        for i in range(1, 4):
            f, t = calc.month_range(calc.add_months(mk, -i), s.settings.month_start_day)
            fl = calc.flow_in(s, f, t)
            spend += fl.spend
            income += fl.income
        return {
            "currency": "PHP (amounts in pesos)",
            "net_worth": calc.net_worth(s, bal) / 100,
            "cash_now": base.start / 100,
            "avg_monthly_spend_3m": round(spend / 3 / 100, 2),
            "avg_monthly_income_3m": round(income / 3 / 100, 2),
            "avg_monthly_surplus": round(base.avg_surplus / 100, 2),
            "lowest_projected_balance_12m": base.low.value / 100,
            "lowest_projected_month": base.low.key,
            "minimum_balance_setting": safety_floor_minor / 100,
            "budgets": [
                {
                    "name": b.name,
                    "limit": v.limit / 100,
                    "spent": v.spent / 100,
                    "days_left": v.days_left,
                }
                for b in s.budgets
                if not b.archived
                for v in [calc.budget_view(s, b)]
            ],
        }

    def spending_by_category(**kw: Any) -> dict[str, Any]:
        a = DaysArgs(**kw)
        f = calc.flow_in(s, s.today - timedelta(days=a.days - 1), s.today)
        top = sorted(f.by_cat.items(), key=lambda kv: -kv[1])[:12]
        return {
            "days": a.days,
            "total_spend": f.spend / 100,
            "total_income": f.income / 100,
            "by_category": [
                {
                    "category": cats[k].name if k in cats else "Uncategorised",
                    "amount": v / 100,
                }
                for k, v in top
            ],
        }

    def recent_transactions(**kw: Any) -> dict[str, Any]:
        a = DaysArgs(**kw)
        if scope != "records":
            return {
                "error": "records_not_shared",
                "hint": "Totals only: the user shares aggregates.",
            }
        since = s.today - timedelta(days=a.days - 1)
        rows = [r for r in s.records if r.day >= since and calc.is_flow(r)][
            -MAX_RECORDS:
        ]
        return {
            "transactions": [
                {
                    "day": r.day.isoformat(),
                    "type": r.type,
                    "amount": r.amount / 100,
                    "payee": r.payee,
                    "category": cats[r.category_id].name
                    if r.category_id in cats
                    else None,
                }
                for r in rows
            ]
        }

    def worked_answer(**kw: Any) -> dict[str, Any]:
        a = QuestionArgs(**kw)
        out = advisor.answer(
            s,
            advisor.advisor_question(a.question),
            scope=scope,
            safety_floor_minor=safety_floor_minor,
        )
        return {
            "text": flatten(out["paragraphs"]),
            "verdict": out.get("verdict"),
            "working": out.get("working"),
            "needs_records": out.get("needs_records"),
        }

    specs: list[tuple[Callable[..., Any], type[BaseModel], str]] = [
        (summary, NoArgs, "Balances, averages, 12-month projection and budgets."),
        (spending_by_category, DaysArgs, "Spending by category over the last N days."),
        (
            recent_transactions,
            DaysArgs,
            "Individual transactions (only when records are shared).",
        ),
        (
            worked_answer,
            QuestionArgs,
            "The app's own worked answer for afford/financing/leaks/emergency/invest/review questions.",
        ),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=d, args_schema=sch
        )
        for fn, sch, d in specs
    ]


SYSTEM = """You are the finance advisor inside Personal SOP, for a user in the
Philippines. Answer in a few short paragraphs, plainly, with peso amounts from
the tools — never invent numbers. The user shares {scope}. Prefer the
`worked_answer` tool for affordability, financing, emergency-fund, investing and
monthly-review questions, then explain it. End with: "{disclaimer}" """


# ---------------------------------------------------------------- ask


def _resolve(ctx: Ctx) -> ai.ResolvedModel | None:
    resolved = ai.resolve_model(ctx, "advisor")
    if resolved is None:
        return None
    try:
        ai.check_budget(ctx)
    except HTTPException:
        return None
    return resolved


def _history(ctx: Ctx, thread_id: uuid.UUID) -> list[BaseMessage]:
    from sqlmodel import col

    rows = owned_repo.list_rows(
        ctx,
        AdvisorMessage,
        col(AdvisorMessage.thread_id) == thread_id,
        order_by=[col(AdvisorMessage.at).desc()],
        limit=HISTORY,
    )
    return [
        HumanMessage(m.text) if m.role == "user" else AIMessage(m.text)
        for m in reversed(rows)
    ]


def require_thread(ctx: Ctx, thread_id: uuid.UUID) -> AdvisorThread:
    return owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")


def ask(
    ctx: Ctx, *, thread_id: uuid.UUID, data: AskIn, emit: Emit = _noop
) -> tuple[AdvisorMessage, AdvisorMessage]:
    """Store the question and its answer (replay-safe on ``data.id``)."""
    thread = require_thread(ctx, thread_id)
    st = repo.settings_row(ctx)
    scope: Scope = data.scope or (
        "records" if st.ai_scope == "records" else "aggregates"
    )
    q_id = data.id or uuid.uuid4()
    a_id = derived_id("advisor-answer", q_id, "ai")
    existing = owned_repo.get(ctx, AdvisorMessage, q_id)
    if existing is not None:
        ans = owned_repo.get(ctx, AdvisorMessage, a_id)
        if ans is not None:
            return existing, ans
    history = _history(ctx, thread.id)
    q = existing or services._add_message(
        ctx,
        thread.id,
        S.MessageCreate(id=q_id, role="user", text=data.text, scope=scope),
    )
    emit("message", S.MessagePublic.model_validate(q).model_dump(mode="json"))
    s = repo.load_state(ctx, st)
    resolved = _resolve(ctx)
    answer: dict[str, Any] | None = None
    text: str | None = None
    if resolved is not None:
        try:
            reply = capture.run_agent(
                ctx,
                resolved,
                system=SYSTEM.format(
                    scope="individual transactions"
                    if scope == "records"
                    else "totals only",
                    disclaimer=advisor.DISCLAIMER,
                ),
                messages=[*history, HumanMessage(data.text)],
                tools=advisor_tools(s, scope, st.safety_floor_minor),
                on_text=lambda d: emit("text.delta", {"text": d}),
            )
            text = reply.strip()
            if advisor.DISCLAIMER not in text:
                text = f"{text}\n\n{advisor.DISCLAIMER}".strip()
            answer = {
                "intent": "ai",
                "engine": "ai",
                "disclaimer": advisor.DISCLAIMER,
                "scope": scope,
            }
        except capture.SeamError:
            text = None
    if text is None:
        answer = advisor.answer(
            s,
            advisor.advisor_question(data.text),
            scope=scope,
            safety_floor_minor=st.safety_floor_minor,
        )
        answer["engine"] = "rules"
        text = flatten(answer["paragraphs"]) or advisor.DISCLAIMER
        emit("answer", answer)
    a = services._add_message(
        ctx,
        thread.id,
        S.MessageCreate(
            id=a_id, role="ai", text=text[:8000], answer=answer, scope=scope
        ),
    )
    # Both rows are stamped with the request's ``now``; the thread orders by
    # ``at``, so the answer sorts after its question.
    a.at = q.at + timedelta(microseconds=1)
    ctx.session.add(a)
    ctx.commit()
    return q, a


def stream(ctx: Ctx, *, thread_id: uuid.UUID, data: AskIn) -> Any:
    """``POST /finance/advisor/threads/{id}/ask/stream``: SSE frames
    ``message`` (the stored question), ``text.delta`` (AI), ``answer`` (the
    deterministic structured answer), ``done`` (the stored answer) and
    ``error``. The thread is checked before the stream opens (404)."""
    from fastapi.responses import StreamingResponse

    require_thread(ctx, thread_id)

    def work(emit: Emit) -> None:
        _, a = ask(ctx, thread_id=thread_id, data=data, emit=emit)
        emit("done", S.MessagePublic.model_validate(a).model_dump(mode="json"))

    return StreamingResponse(
        capture.stream_work(work, name="advisor-ask"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
