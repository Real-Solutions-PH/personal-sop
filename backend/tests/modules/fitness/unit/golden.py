"""Load the prototype's golden fixtures (``scripts/golden/fitness.golden.test.ts``)
into :mod:`app.modules.fitness.calc` snapshots.

Only the INPUT state is read from the fixture into Python types; every
expected value a test compares against is the prototype's own output.
"""

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.modules.fitness.calc import (
    ExerciseS,
    FitState,
    MealItemS,
    MealS,
    SetS,
    SettingsS,
    TargetS,
    TemplateItemS,
    TemplateS,
    WeighInS,
    WorkoutExerciseS,
    WorkoutS,
)
from app.shared.day import DayClock

GOLDEN = Path(__file__).resolve().parents[3] / "golden"
CLOCK = DayClock("Asia/Manila", 4)


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((GOLDEN / f"{name}.json").read_text())
    return data


def frozen_now(name: str = "fitness-calc") -> datetime:
    return tsr(load(name)["frozenNow"])


def ts(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


def tsr(s: str) -> datetime:
    return datetime.fromisoformat(s)


def state_from(raw: dict[str, Any]) -> FitState:
    st = raw["settings"]
    return FitState(
        exercises=[
            ExerciseS(
                id=e["id"],
                name=e["name"],
                equipment=e["equipment"],
                muscle=e["muscle"],
                load_type=e["loadType"],
                rep_min=e["repMin"],
                rep_max=e["repMax"],
                increment=e["increment"],
                archived=bool(e.get("archived")),
            )
            for e in raw["exercises"]
        ],
        templates=[
            TemplateS(
                id=t["id"],
                name=t["name"],
                items=[TemplateItemS(i["exerciseId"], i["sets"]) for i in t["items"]],
            )
            for t in raw["templates"]
        ],
        workouts=[
            WorkoutS(
                id=w["id"],
                name=w["name"],
                started_at=tsr(w["startedAt"]),
                ended_at=ts(w.get("endedAt")),
                status=w["status"],
                template_id=w.get("templateId"),
                source=w.get("source", "live"),
                exercises=[
                    WorkoutExerciseS(
                        id=we["id"],
                        exercise_id=we["exerciseId"],
                        note=we.get("note"),
                        sets=[
                            SetS(
                                id=x["id"],
                                reps=x["reps"],
                                weight=x["weight"],
                                kind=x["kind"],
                                completed_at=ts(x.get("completedAt")),
                            )
                            for x in we["sets"]
                        ],
                    )
                    for we in w["exercises"]
                ],
            )
            for w in raw["workouts"]
        ],
        weigh_ins=[
            WeighInS(
                id=w["id"],
                measured_at=tsr(w["measuredAt"]),
                weight_kg=w["weightKg"],
                body_fat_pct=w.get("bodyFatPct"),
            )
            for w in raw["weighIns"]
        ],
        targets=[
            TargetS(
                id=t["id"],
                effective_from=date.fromisoformat(t["effectiveFrom"]),
                kcal=t["kcal"],
                protein=t["protein"],
                carbs=t["carbs"],
                fat=t["fat"],
            )
            for t in raw["targets"]
        ],
        meals=[
            MealS(
                id=m["id"],
                eaten_at=tsr(m["eatenAt"]),
                label=m["label"],
                status=m["status"],
                source=m["source"],
                raw_input=m["rawInput"],
                confidence=m.get("confidence"),
                items=[
                    MealItemS(
                        id=i["id"],
                        name=i["name"],
                        qty=i["qty"],
                        unit=i["unit"],
                        kcal=i["kcal"],
                        protein=i["protein"],
                        carbs=i["carbs"],
                        fat=i["fat"],
                        assumption=i.get("assumption"),
                    )
                    for i in m["items"]
                ],
            )
            for m in raw["meals"]
        ],
        settings=SettingsS(
            units=st["units"],
            rest_sec=st["restSec"],
            weekly_target=st["weeklyTarget"],
            progression=st["progression"],
            goal_direction=st["goalDirection"],
            goal_weight=st.get("goalWeight"),
        ),
        clock=CLOCK,
    )
