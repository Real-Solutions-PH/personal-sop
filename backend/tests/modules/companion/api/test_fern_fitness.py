"""Fern manages everything in fitness the person already has: exercises,
templates, workouts (live and past), meals, weigh-ins, the macro target,
settings and saved foods. Each test runs a whole scripted turn (the ask,
the tool call, its result, the card) and then checks the rows, Undo, and
for removals the Confirm the card waits for."""

import json
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage
from sqlmodel import Session

from app.modules.companion import routing
from app.modules.fitness.models import (
    Exercise,
    FitnessSettings,
    FoodItem,
    MacroTarget,
    Meal,
    MealItem,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from tests.modules.capture.api.helpers import Api, install, say, user
from tests.modules.companion.api.test_fern_agent import (
    act,
    live,
    rows_of,
    stream,
    undo,
)


def fern(client: TestClient, db: Session) -> Any:
    api: Any = user(client, db, accounts=False)
    api.assign("chat")
    api.get("/fitness/settings")  # first visit: the seeded library and split
    return api


def turn(
    api: Api,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    text: str,
    *calls: Any,
    reply: str = "Done.",
) -> tuple[dict[str, Any], Any]:
    """One turn: the step of its first call, and the scripted model."""
    model = install(monkeypatch, say("", *calls), say(reply))
    events = stream(api, client, text)
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    return step, model


def tool_result(model: Any) -> dict[str, Any]:
    """What the model was handed back from its first tool call."""
    msg = next(m for m in model.seen[1] if isinstance(m, ToolMessage))
    out: dict[str, Any] = json.loads(str(msg.content))
    return out


def exercise(api: Api, name: str) -> Exercise:
    return next(e for e in live(rows_of(api, Exercise)) if e.name == name)


def template(api: Api, name: str) -> WorkoutTemplate:
    return next(t for t in live(rows_of(api, WorkoutTemplate)) if t.name == name)


def template_names(api: Api, t: WorkoutTemplate) -> list[tuple[str, int]]:
    names = {e.id: e.name for e in rows_of(api, Exercise)}
    items = [i for i in live(rows_of(api, TemplateItem)) if i.template_id == t.id]
    return [
        (names[i.exercise_id], i.sets) for i in sorted(items, key=lambda i: i.position)
    ]


def workout_sets(api: Api, w_id: Any) -> list[tuple[str, int, float, bool]]:
    names = {e.id: e.name for e in rows_of(api, Exercise)}
    wes = sorted(
        (x for x in live(rows_of(api, WorkoutExercise)) if x.workout_id == w_id),
        key=lambda x: x.position,
    )
    out = []
    for we in wes:
        sets = sorted(
            (
                s
                for s in live(rows_of(api, WorkoutSet))
                if s.workout_exercise_id == we.id
            ),
            key=lambda s: s.position,
        )
        out += [
            (names[we.exercise_id], s.reps, s.weight, s.completed_at is not None)
            for s in sets
        ]
    return out


# ------------------------------------------------------------ exercises


def test_rename_and_retype_an_exercise_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "rename lat pulldown to wide grip pulldown, it's a machine",
        act(
            "edit_exercise",
            exercise="lat pulldown",
            new_name="Wide Grip Pulldown",
            equipment="machine",
        ),
    )
    assert step["tool"] == "edit_exercise" and step["ok"], step
    assert step["state"] == "saved"
    assert step["summary"] == (
        "Changed exercise: Lat Pulldown · equipment cable → machine, "
        "name Lat Pulldown → Wide Grip Pulldown"
    )
    ex = exercise(api, "Wide Grip Pulldown")
    assert (ex.equipment, ex.muscle) == ("machine", "back")

    undo(api, step)
    ex = exercise(api, "Lat Pulldown")
    assert ex.equipment == "cable"


def test_an_ambiguous_exercise_name_changes_nothing_and_lists_the_matches(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, model = turn(
        api,
        client,
        monkeypatch,
        "rename press to strict press",
        act("edit_exercise", exercise="press", new_name="Strict Press"),
        reply="Which press: bench, incline, overhead or leg press?",
    )
    assert not step["ok"]
    assert step["summary"] == "More than one matches; asking which"
    got = tool_result(model)
    assert got["error"] == "several_match"
    assert set(got["matches"]) == {
        "Barbell Bench Press",
        "Incline Dumbbell Press",
        "Overhead Press",
        "Leg Press",
    }
    assert "Strict Press" not in {e.name for e in rows_of(api, Exercise)}


def test_create_a_timed_exercise_then_undo_removes_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "add a treadmill walk exercise, timed, tracking speed",
        act(
            "create_exercise",
            name="Treadmill Walk",
            type="time",
            track="speed",
            muscle="cardio",
            equipment="machine",
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"].startswith("Created exercise: Treadmill Walk")
    ex = exercise(api, "Treadmill Walk")
    assert (ex.load_type, ex.track, ex.muscle) == ("time", "speed", "cardio")

    undo(api, step)
    assert "Treadmill Walk" not in {e.name for e in live(rows_of(api, Exercise))}


def test_creating_a_variant_of_an_existing_exercise_reuses_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "add pec deck machine",
        act("create_exercise", name="Pec deck machine", equipment="machine"),
    )
    before = len(rows_of(api, Exercise))
    for said in ("Pec deck fly", "pec-deck", "Butterfly"):
        _, model = turn(
            api,
            client,
            monkeypatch,
            f"add {said}",
            act("create_exercise", name=said),
        )
        out = tool_result(model)
        assert out["reused"] is True and out["exercise"]["name"] == "Pec deck machine"
    assert len(rows_of(api, Exercise)) == before


def test_creating_a_routine_by_an_existing_name_reuses_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    before = len(live(rows_of(api, WorkoutTemplate)))
    _, model = turn(
        api,
        client,
        monkeypatch,
        "make a push a routine",
        act(
            "create_workout_template",
            name="push a",
            exercises=[{"exercise": "Bench press", "sets": 3}],
        ),
    )
    out = tool_result(model)
    assert out["reused"] is True and out["template"]["name"] == "Push A"
    assert len(live(rows_of(api, WorkoutTemplate))) == before


def test_archiving_an_exercise_waits_for_confirm_then_undo_brings_it_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "delete face pull from my exercises",
        act("remove_item", what="exercise", name="face pull"),
    )
    assert step["ok"] and step["state"] == "proposed", step
    assert step["summary"] == "Archive: Face Pull (waiting for your OK)"
    assert not exercise(api, "Face Pull").archived  # nothing before Confirm

    api.post(f"/capture/cards/{step['card_id']}/confirm")
    assert exercise(api, "Face Pull").archived
    undo(api, step)
    assert not exercise(api, "Face Pull").archived


def test_a_delete_waits_until_the_person_says_confirm(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The removal waits; a later "yes, confirm" turn runs confirm_pending,
    and only then is the template gone."""
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "delete my legs a template",
        act("remove_item", what="template", name="legs a"),
        reply="Delete Legs A? It's waiting for your OK.",
    )
    assert step["state"] == "proposed"
    assert "Legs A" in {t.name for t in live(rows_of(api, WorkoutTemplate))}

    step2, _ = turn(api, client, monkeypatch, "yes, confirm", act("confirm_pending"))
    assert step2["tool"] == "confirm_pending" and step2["ok"], step2
    assert step2["summary"].startswith("Saved:")
    assert "Legs A" not in {t.name for t in live(rows_of(api, WorkoutTemplate))}

    undo(api, step)
    assert template_names(api, template(api, "Legs A")) == [
        ("Back Squat", 3),
        ("Romanian Deadlift", 3),
        ("Leg Press", 3),
    ]


# ------------------------------------------------------------ templates


def test_edit_a_template_adds_removes_and_renames_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "in pull a drop face pulls, add 4 sets of hammer curls, call it Pull Day",
        act(
            "edit_workout_template",
            template="pull a",
            new_name="Pull Day",
            remove=["face pull"],
            add=[{"exercise": "Hammer Curl", "sets": 4}],
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"] == (
        "Changed template: Pull A · renamed to Pull Day; added Hammer Curl; "
        "removed face pull"
    )
    assert template_names(api, template(api, "Pull Day")) == [
        ("Barbell Row", 3),
        ("Lat Pulldown", 3),
        ("Pull-up", 3),
        ("Dumbbell Curl", 3),
        ("Hammer Curl", 4),
    ]

    undo(api, step)
    assert template_names(api, template(api, "Pull A")) == [
        ("Barbell Row", 3),
        ("Lat Pulldown", 3),
        ("Pull-up", 3),
        ("Face Pull", 3),
        ("Dumbbell Curl", 3),
    ]


def test_reorder_a_template_and_set_a_timed_goal(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "make legs a: leg press first, then squat, then a 20 minute plank... "
        "no, keep rdl last",
        act(
            "edit_workout_template",
            template="legs a",
            exercises=[
                {"exercise": "leg press", "sets": 4},
                {"exercise": "back squat", "sets": 3},
                {"exercise": "plank", "sets": 1, "minutes": 20},
                {"exercise": "romanian deadlift", "sets": 3},
            ],
        ),
    )
    assert step["ok"], step
    t = template(api, "Legs A")
    assert template_names(api, t) == [
        ("Leg Press", 4),
        ("Back Squat", 3),
        ("Plank", 1),
        ("Romanian Deadlift", 3),
    ]
    plank = next(
        i
        for i in live(rows_of(api, TemplateItem))
        if i.template_id == t.id and i.position == 2
    )
    assert plank.target_sec == 1200

    undo(api, step)
    assert [n for n, _ in template_names(api, template(api, "Legs A"))] == [
        "Back Squat",
        "Romanian Deadlift",
        "Leg Press",
    ]


# ------------------------------------------------------------ workouts


def test_start_a_workout_from_a_template_then_undo_discards_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "start push a",
        act("start_workout", template="push a"),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"] == "Started workout: Push A"
    [w] = live(rows_of(api, Workout))
    assert (w.name, w.status) == ("Push A", "in_progress")
    assert {n for n, *_ in workout_sets(api, w.id)} >= {"Barbell Bench Press"}

    undo(api, step)
    [w] = rows_of(api, Workout)
    assert w.status == "discarded" and w.deleted_at is not None


def test_live_workout_add_sets_edit_a_set_finish_and_undo_reopens(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    started = api.post("/fitness/workouts/start", {"source": "empty"})
    w_id = started["workout"]["id"]
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "did lateral raises 3x12 at 8kg, then finish",
        act(
            "edit_workout",
            add=[
                {
                    "exercise": "lateral raise",
                    "sets": [
                        {"reps": 12, "kg": 8},
                        {"reps": 12, "kg": 8},
                        {"reps": 10, "kg": 8},
                    ],
                }
            ],
            finish="drop_unticked",
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert "added lateral raise (3 sets)" in step["summary"]
    assert "finished" in step["summary"]
    w = next(x for x in rows_of(api, Workout) if str(x.id) == w_id)
    assert w.status == "finished"
    assert workout_sets(api, w.id) == [
        ("Lateral Raise", 12, 8.0, True),
        ("Lateral Raise", 12, 8.0, True),
        ("Lateral Raise", 10, 8.0, True),
    ]

    undo(api, step)
    w = next(x for x in rows_of(api, Workout) if str(x.id) == w_id)
    assert (w.status, w.ended_at) == ("in_progress", None)
    assert workout_sets(api, w.id) == []


def test_edit_and_remove_sets_of_a_past_workout_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    logged, _ = turn(
        api,
        client,
        monkeypatch,
        "did bench 3 sets of 8 at 60",
        act(
            "log_workout",
            name="Push",
            exercises=[
                {
                    "exercise": "Barbell Bench Press",
                    "sets": [{"reps": 8, "weight": 60}] * 3,
                }
            ],
        ),
    )
    assert logged["state"] == "saved", logged
    [w] = live(rows_of(api, Workout))

    step, _ = turn(
        api,
        client,
        monkeypatch,
        "my second bench set was 65 not 60, and I only did 2 sets",
        act(
            "edit_workout",
            workout_id=str(w.id),
            sets=[{"exercise": "bench", "set": 2, "kg": 65}],
            remove_sets=[{"exercise": "bench", "set": 3}],
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    # The day is the person's business day, not the test host's.
    assert step["summary"].startswith("Changed workout: Push (")
    assert step["summary"].endswith("· bench set 2; removed bench set 3")
    assert workout_sets(api, w.id) == [
        ("Barbell Bench Press", 8, 60.0, True),
        ("Barbell Bench Press", 8, 65.0, True),
    ]

    undo(api, step)
    assert workout_sets(api, w.id) == [("Barbell Bench Press", 8, 60.0, True)] * 3


def test_a_set_number_past_the_end_changes_nothing(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    push = template(api, "Push A")
    api.post(
        "/fitness/workouts/start", {"source": "template", "template_id": str(push.id)}
    )
    step, model = turn(
        api,
        client,
        monkeypatch,
        "change set 9 of bench to 70",
        act("edit_workout", sets=[{"exercise": "bench", "set": 9, "kg": 70}]),
    )
    assert not step["ok"]
    assert tool_result(model)["error"] == "no_such_set"


def test_deleting_a_workout_waits_for_confirm_and_undo_restores_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "ran 5k",
        act("log_workout", name="Run", cardio={"activity": "Run", "km": 5}),
    )
    [w] = live(rows_of(api, Workout))
    found, model = turn(
        api,
        client,
        monkeypatch,
        "find my workouts",
        act("find_fitness_logs", what="workouts"),
    )
    assert found["summary"] == "Found 1 workout"
    assert tool_result(model)["workouts"][0]["id"] == str(w.id)

    step, _ = turn(
        api,
        client,
        monkeypatch,
        "delete that run",
        act("remove_item", what="workout", ids=[str(w.id)]),
    )
    assert step["state"] == "proposed"
    assert live(rows_of(api, Workout)) != []
    api.post(f"/capture/cards/{step['card_id']}/confirm")
    assert live(rows_of(api, Workout)) == []
    undo(api, step)
    assert [x.id for x in live(rows_of(api, Workout))] == [w.id]


# ------------------------------------------------------------ meals


def _meal(api: Api) -> dict[str, Any]:
    return api.post(  # type: ignore[no-any-return]
        "/fitness/meals",
        {
            "label": "breakfast",
            "raw_input": "2 eggs and rice",
            "items": [
                {
                    "name": "Egg",
                    "qty": 2,
                    "unit": "pc",
                    "kcal": 140,
                    "protein": 12,
                    "carbs": 1,
                    "fat": 10,
                },
                {
                    "name": "Rice",
                    "qty": 1,
                    "unit": "cup",
                    "kcal": 205,
                    "protein": 4,
                    "carbs": 45,
                    "fat": 0,
                },
            ],
        },
    )


def test_move_a_meal_and_resize_an_item_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _meal(api)["id"]
    yday = date.today() - timedelta(days=1)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "that breakfast was yesterday's lunch, and it was 2 cups of rice",
        act(
            "edit_meal",
            meal_id=meal_id,
            label="lunch",
            day=yday.isoformat(),
            edit_items=[{"item": "rice", "qty": 2}],
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"].startswith("Changed breakfast (")
    assert "moved to lunch" in step["summary"] and "rice: qty 2.0" in step["summary"]
    m = next(x for x in rows_of(api, Meal) if str(x.id) == meal_id)
    assert m.label == "lunch"
    rice = next(i for i in live(rows_of(api, MealItem)) if i.name == "Rice")
    assert (rice.qty, rice.kcal) == (2, 410)

    undo(api, step)
    m = next(x for x in rows_of(api, Meal) if str(x.id) == meal_id)
    assert m.label == "breakfast"
    rice = next(i for i in live(rows_of(api, MealItem)) if i.name == "Rice")
    assert (rice.qty, rice.kcal) == (1, 205)


def test_remove_and_add_meal_items_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _meal(api)["id"]
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "no rice, I had a banana instead",
        act(
            "edit_meal",
            meal_id=meal_id,
            remove_items=["rice"],
            add_items=[
                {
                    "name": "Banana",
                    "qty": 1,
                    "unit": "pc",
                    "kcal": 105,
                    "carbs": 27,
                    "sugar": 14,
                    "sodium": 1,
                    "grams": 118,
                }
            ],
        ),
    )
    assert step["ok"], step
    names = {i.name for i in live(rows_of(api, MealItem))}
    assert names == {"Egg", "Banana"}
    undo(api, step)
    assert {i.name for i in live(rows_of(api, MealItem))} == {"Egg", "Rice"}


def test_copy_a_meal_logs_it_again_today(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _meal(api)["id"]
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "same breakfast as before",
        act("copy_meal", meal_id=meal_id),
    )
    # A meal follows the person's rule for meals: it waits for Confirm.
    assert step["ok"] and step["state"] == "proposed", step
    assert step["summary"].startswith("Logged breakfast again on ")
    assert step["summary"].endswith("· 2 items, 345 kcal (waiting for your OK)")
    api.post(f"/capture/cards/{step['card_id']}/confirm")
    assert len(live(rows_of(api, Meal))) == 2


# ------------------------------------------------------------ weigh-ins


def test_edit_a_weigh_in_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    wid = api.post("/fitness/weigh-ins", {"weight_kg": 72.4})["id"]
    found, model = turn(
        api,
        client,
        monkeypatch,
        "my weigh ins",
        act("find_fitness_logs", what="weigh_ins"),
    )
    assert tool_result(model)["weigh_ins"][0]["id"] == wid
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "that weigh-in was 71.4 not 72.4",
        act("edit_weigh_in", weigh_in_id=wid, kg=71.4),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"].endswith("weight kg 72.4 → 71.4")
    [w] = live(rows_of(api, WeighIn))
    assert w.weight_kg == 71.4
    undo(api, step)
    [w] = live(rows_of(api, WeighIn))
    assert w.weight_kg == 72.4


# ------------------------------------------------------------ targets


def test_change_one_macro_and_a_limit_keeps_the_rest_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    api.put("/fitness/targets", {"kcal": 2000, "protein": 120, "carbs": 220, "fat": 60})
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "set my protein to 150 and sodium limit to 1800",
        act("set_macro_target", protein=150, sodium_max_mg=1800),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"] == (
        "Changed macro target from today · protein 120.0 → 150.0, sodium max mg 1800.0"
    )
    [t] = live(rows_of(api, MacroTarget))
    assert (t.kcal, t.protein, t.carbs, t.fat, t.sodium_max_mg) == (
        2000,
        150,
        220,
        60,
        1800,
    )

    undo(api, step)
    [t] = live(rows_of(api, MacroTarget))
    assert (t.protein, t.sodium_max_mg) == (120, None)


def test_a_partial_target_with_none_set_yet_asks_for_the_rest(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, model = turn(
        api,
        client,
        monkeypatch,
        "protein goal 150",
        act("set_macro_target", protein=150),
    )
    assert not step["ok"]
    assert (
        tool_result(model)["error"] == "no_target_yet_give_kcal_protein_carbs_and_fat"
    )
    assert live(rows_of(api, MacroTarget)) == []


# ------------------------------------------------------------ settings


def test_fitness_settings_change_goal_and_weekly_target_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "I want to cut to 68 kg, training 5 times a week, rest 90 seconds",
        act(
            "fitness_settings",
            goal_direction="cut",
            goal_weight=68,
            weekly_target=5,
            rest_sec=90,
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    [s] = live(rows_of(api, FitnessSettings))
    assert (s.goal_direction, s.goal_weight, s.weekly_target, s.rest_sec) == (
        "cut",
        68,
        5,
        90,
    )
    undo(api, step)
    [s] = live(rows_of(api, FitnessSettings))
    assert (s.goal_direction, s.goal_weight, s.weekly_target, s.rest_sec) == (
        "maintain",
        None,
        4,
        120,
    )


# ------------------------------------------------------------ food library


def test_rename_a_saved_food_then_delete_it_with_confirm(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "save pancit canton: 290 kcal per pack",
        act("save_food", name="Pancit Canton", basis="piece", kcal=290, protein=6),
    )
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "rename pancit canton to Lucky Me Pancit Canton, it's 300 kcal",
        act(
            "edit_food",
            food="pancit canton",
            new_name="Lucky Me Pancit Canton",
            kcal=300,
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    [f] = live(rows_of(api, FoodItem))
    assert (f.name, f.key, f.kcal) == (
        "Lucky Me Pancit Canton",
        "lucky me pancit canton",
        300,
    )
    undo(api, step)
    [f] = live(rows_of(api, FoodItem))
    assert (f.name, f.kcal) == ("Pancit Canton", 290)

    gone, _ = turn(
        api,
        client,
        monkeypatch,
        "delete pancit canton from my foods",
        act("remove_item", what="food", name="pancit canton"),
    )
    assert gone["state"] == "proposed"
    api.post(f"/capture/cards/{gone['card_id']}/confirm")
    assert live(rows_of(api, FoodItem)) == []
    undo(api, gone)
    assert len(live(rows_of(api, FoodItem))) == 1


# ------------------------------------------------------------ reading


def test_find_a_workout_shows_numbered_sets(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    turn(
        api,
        client,
        monkeypatch,
        "squat 2x5 at 100",
        act(
            "log_workout",
            name="Legs",
            exercises=[
                {"exercise": "Back Squat", "sets": [{"reps": 5, "weight": 100}] * 2}
            ],
        ),
    )
    _, model = turn(
        api,
        client,
        monkeypatch,
        "show my workouts",
        act("find_fitness_logs", what="workouts"),
    )
    [w] = tool_result(model)["workouts"]
    assert w["exercises"] == [
        {
            "exercise": "Back Squat",
            "sets": [
                {"set": 1, "reps": 5, "kg": 100.0, "done": True},
                {"set": 2, "reps": 5, "kg": 100.0, "done": True},
            ],
        }
    ]
    _, model = turn(
        api,
        client,
        monkeypatch,
        "which exercises have curl",
        act("find_fitness_logs", what="exercises", query="curl"),
    )
    assert [e["name"] for e in tool_result(model)["exercises"]] == ["Dumbbell Curl"]


def test_a_live_workout_is_in_todays_facts(client: TestClient, db: Session) -> None:
    from app.modules.companion import grounding
    from app.shared.context import Ctx

    api = fern(client, db)
    w = api.post("/fitness/workouts/start", {"source": "empty"})["workout"]
    ctx = Ctx(session=db, user=api.user)  # type: ignore[attr-defined]
    assert grounding.snapshot(ctx)["workout_in_progress"] == {
        "id": w["id"],
        "name": w["name"],
    }


@pytest.mark.parametrize(
    "text,tool",
    [
        ("rename lat pulldown to wide grip pulldown", "edit_exercise"),
        ("rename my push day template", "edit_workout_template"),
        ("start my pull day", "start_workout"),
        ("change my second bench set to 65", "edit_workout"),
        ("move that breakfast to lunch", "edit_meal"),
        ("fix my weigh-in, it was 71", "edit_weigh_in"),
        ("set my protein target to 150", "set_macro_target"),
        ("change my goal weight to 68", "fitness_settings"),
        ("rename pancit canton in my food library", "edit_food"),
        ("add a treadmill walk exercise", "create_exercise"),
    ],
)
def test_fitness_words_offer_the_fitness_tools(text: str, tool: str) -> None:
    names = routing.pick(text, [])
    assert names is not None and tool in names, (text, sorted(names or []))
