"""Fern's tools for everything in fitness the person already has: the
exercise library, workout templates, workouts (live and past), meals,
weigh-ins, the macro target, fitness settings and the food library.

Each finds what it changes by name or by an id from ``find_fitness_logs``;
a name that fits several things returns them (``several_match``) so Fern
asks which one. An edit lands as an ``edit`` card that saves at once with
Undo; removals stay with ``remove_item``, whose card waits for the person's
Confirm. The changes themselves are the fitness module's
(``fitness.chat``); every tool's ``summary`` says what changed.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Annotated, Any, Literal

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from app.modules.capture import ports
from app.modules.capture.parse import RecordDraft, meal_label
from app.shared.ids import derived_id

if TYPE_CHECKING:
    from app.modules.capture.agent import Run

Manage = Callable[..., dict[str, Any]]
Card = Callable[..., dict[str, Any]]

Name = Annotated[str, Field(min_length=1, max_length=80)]
Muscle = Literal[
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "quads",
    "hamstrings",
    "glutes",
    "core",
    "cardio",
    "calves",
    "forearms",
]
Equipment = Literal["barbell", "dumbbell", "machine", "cable", "bodyweight"]
LoadType = Literal["weight", "bodyweight", "reps", "time"]
Reps = Annotated[int, Field(ge=1, le=1000)]
Kg = Annotated[float, Field(ge=0, le=2000)]
Minutes = Annotated[float, Field(gt=0, le=1440)]
Macro = Annotated[float, Field(ge=0, le=20000)]


def _fx() -> Any:
    return ports.fitness.chat


# ------------------------------------------------------------- arguments

# Asked for on every estimate (the daily limits count them); a meal sent
# without them is still saved, with a warning on its card.
SUGAR_SAYS = "Grams of sugar; estimate it, 0 when there is none."
SODIUM_SAYS = "Milligrams of sodium; estimate it, 0 when there is none."


class FindLogsArgs(BaseModel):
    what: Literal["meals", "weigh_ins", "workouts", "exercises", "templates"]
    days: Annotated[int, Field(ge=1, le=90)] = 7
    query: Annotated[str, Field(max_length=80)] | None = Field(
        default=None, description="Words of a name (exercises, templates)."
    )
    id: Annotated[str, Field(max_length=40)] | None = Field(
        default=None, description="One workout or meal's id: its full detail."
    )


class ExerciseFields(BaseModel):
    muscle: Muscle | None = None
    equipment: Equipment | None = None
    type: LoadType | None = Field(
        default=None,
        description="time for a timed exercise (plank, treadmill walk); "
        "bodyweight or reps for no added load.",
    )
    rep_min: Reps | None = None
    rep_max: Reps | None = None
    increment: Annotated[float, Field(ge=0, le=100)] | None = Field(
        default=None, description="kg added when progressing."
    )
    track: Literal["speed", "weight", "none"] | None = Field(
        default=None,
        description="A timed exercise's second number: speed (walk, run), "
        "weight (weighted plank) or none.",
    )


class ExerciseCreateArgs(ExerciseFields):
    name: Name


class ExerciseEditArgs(ExerciseFields):
    exercise: Name = Field(description="The exercise's current name.")
    new_name: Name | None = None
    archived: bool | None = Field(
        default=None, description="false brings an archived exercise back."
    )


class SlotArgs(BaseModel):
    exercise: Name
    sets: Annotated[int, Field(ge=1, le=20)] = 3
    minutes: Minutes | None = Field(
        default=None, description="A timed exercise's goal per set."
    )


class TemplateEditArgs(BaseModel):
    template: Name = Field(description="The template's current name.")
    new_name: Name | None = None
    exercises: list[SlotArgs] | None = Field(
        default=None,
        max_length=40,
        description="The whole new list in order (to reorder, or change "
        "sets or goals); omit to keep it.",
    )
    add: list[SlotArgs] = Field(default_factory=list, max_length=20)
    remove: list[Name] = Field(default_factory=list, max_length=20)


class StartArgs(BaseModel):
    template: Name | None = Field(default=None, description="Start from this template.")
    repeat_last: bool = Field(
        default=False, description="Repeat the last finished workout."
    )


class SetSpec(BaseModel):
    reps: Annotated[int, Field(ge=0, le=1000)] | None = None
    kg: Kg | None = None
    minutes: Minutes | None = None
    kmh: Annotated[float, Field(ge=0, le=60)] | None = None
    kind: Literal["warmup", "working", "drop", "failure"] | None = None
    done: bool | None = Field(default=None, description="Ticked off.")


class AddExerciseArgs(BaseModel):
    exercise: Name
    sets: list[SetSpec] = Field(
        default_factory=list,
        max_length=20,
        description="The sets done; omit in a live workout to plan them from history.",
    )


class SetEditArgs(SetSpec):
    exercise: Name
    set: Annotated[int, Field(ge=1, le=50)] | None = Field(
        default=None,
        description="Set number from 1 (find_fitness_logs shows them); omit "
        "to add a set.",
    )


class SetRef(BaseModel):
    exercise: Name
    set: Annotated[int, Field(ge=1, le=50)]


class SwapArgs(BaseModel):
    exercise: Name
    to: Name = Field(description="The exercise that takes its place.")


class NoteArgs(BaseModel):
    exercise: Name
    note: Annotated[str, Field(max_length=500)]


class WorkoutEditArgs(BaseModel):
    workout_id: Annotated[str, Field(max_length=40)] | None = Field(
        default=None,
        description="From find_fitness_logs; omit for the workout in "
        "progress, else the latest one.",
    )
    new_name: Name | None = None
    notes: Annotated[str, Field(max_length=2000)] | None = None
    add: list[AddExerciseArgs] = Field(default_factory=list, max_length=10)
    remove: list[Name] = Field(default_factory=list, max_length=10)
    sets: list[SetEditArgs] = Field(default_factory=list, max_length=30)
    remove_sets: list[SetRef] = Field(default_factory=list, max_length=30)
    replace: list[SwapArgs] = Field(default_factory=list, max_length=10)
    exercise_notes: list[NoteArgs] = Field(default_factory=list, max_length=10)
    order: list[Name] = Field(
        default_factory=list, max_length=30, description="Exercises in new order."
    )
    finish: Literal["drop_unticked", "tick_all"] | None = Field(
        default=None,
        description="End the workout in progress, removing unticked sets or "
        "ticking them all.",
    )


class ItemArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    qty: Annotated[float, Field(gt=0, le=10000)] = 1
    unit: Annotated[str, Field(max_length=24)] = "serving"
    kcal: Macro
    protein: Macro = 0
    carbs: Macro = 0
    fat: Macro = 0
    fiber: Macro | None = None
    sat_fat: Macro | None = None
    sugar: Macro | None = Field(default=None, description=SUGAR_SAYS)
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description=SODIUM_SAYS
    )
    grams: Annotated[float, Field(gt=0, le=5000)] | None = Field(
        default=None,
        description="Edible grams this amount weighs (no bone or shell). "
        "Required for estimates.",
    )
    assumption: Annotated[str, Field(max_length=120)] | None = None
    alcohol: Annotated[float, Field(ge=0, le=500)] | None = None


class ItemEditArgs(BaseModel):
    item: Annotated[str, Field(min_length=1, max_length=120)] = Field(
        description="The item's current name."
    )
    qty: Annotated[float, Field(gt=0, le=10000)] | None = Field(
        default=None, description="New amount; its macros scale with it."
    )
    new_name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    kcal: Macro | None = None
    protein: Macro | None = None
    carbs: Macro | None = None
    fat: Macro | None = None
    fiber: Macro | None = None
    sat_fat: Macro | None = None
    sugar: Macro | None = None
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description="milligrams"
    )


# The values an edit can change, checked together with the ones it keeps.
_ITEM_VALUES = (
    "kcal",
    "protein",
    "carbs",
    "fat",
    "fiber",
    "sat_fat",
    "sugar",
    "sodium",
)


class MealEditArgs(BaseModel):
    meal_id: Annotated[str, Field(max_length=40)] = Field(
        description="From find_fitness_logs."
    )
    label: Literal["breakfast", "lunch", "dinner", "snack"] | None = Field(
        default=None, description="Move it to this meal."
    )
    day: date | None = Field(default=None, description="Move it to this day.")
    add_items: list[ItemArgs] = Field(default_factory=list, max_length=20)
    remove_items: list[Annotated[str, Field(max_length=120)]] = Field(
        default_factory=list, max_length=20
    )
    edit_items: list[ItemEditArgs] = Field(default_factory=list, max_length=20)
    confirmed: bool | None = Field(
        default=None, description="true marks an estimated meal as checked."
    )


class MealCopyArgs(BaseModel):
    meal_id: Annotated[str, Field(max_length=40)] = Field(
        description="From find_fitness_logs."
    )
    days_ago: Annotated[int, Field(ge=0, le=366)] = Field(
        default=0, description="The day to log the copy on (0 today)."
    )


class WeighEditArgs(BaseModel):
    weigh_in_id: Annotated[str, Field(max_length=40)] = Field(
        description="From find_fitness_logs."
    )
    kg: Annotated[float, Field(gt=20, le=500)] | None = None
    body_fat_pct: Annotated[float, Field(gt=0, lt=100)] | None = None
    day: date | None = Field(default=None, description="Move it to this day.")
    note: Annotated[str, Field(max_length=280)] | None = None


class TargetArgs(BaseModel):
    kcal: Macro | None = None
    protein: Macro | None = None
    carbs: Macro | None = None
    fat: Macro | None = None
    sat_fat_max_g: Macro | None = None
    sugar_max_g: Macro | None = None
    sodium_max_mg: Annotated[float, Field(ge=0, le=100000)] | None = None
    fiber_g: Macro | None = None


class SettingsArgs(BaseModel):
    units: Literal["kg", "lb"] | None = None
    rest_sec: Annotated[int, Field(ge=0, le=900)] | None = Field(
        default=None, description="Default rest between sets, in seconds."
    )
    weekly_target: Annotated[int, Field(ge=0, le=14)] | None = Field(
        default=None, description="Workouts a week."
    )
    weigh_in_reminder: (
        Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None
    ) = Field(default=None, description="HH:MM.")
    reminder_off: bool = Field(default=False, description="Turn the reminder off.")
    progression: Literal["double", "linear"] | None = None
    goal_direction: Literal["cut", "maintain", "bulk"] | None = None
    goal_weight: Annotated[float, Field(gt=0, lt=500)] | None = None


class FoodEditArgs(BaseModel):
    food: Annotated[str, Field(min_length=1, max_length=160)] = Field(
        description="The saved food's current name."
    )
    new_name: Annotated[str, Field(min_length=1, max_length=160)] | None = None
    basis: Literal["100g", "piece", "serving"] | None = None
    unit_grams: Annotated[float, Field(gt=0, le=5000)] | None = None
    kcal: Macro | None = None
    protein: Macro | None = None
    carbs: Macro | None = None
    fat: Macro | None = None
    fiber: Macro | None = None
    sat_fat: Macro | None = None
    sugar: Macro | None = None
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = None
    aliases: list[Annotated[str, Field(max_length=80)]] | None = Field(
        default=None, max_length=10, description="The whole new list."
    )


# ------------------------------------------------------------- helpers


def _one(rows: list[Any], what: str, label: Callable[[Any], str]) -> Any:
    """The single row a name points at, or the error that says why not."""
    if not rows:
        return {"error": f"no_{what}_like_that"}
    if len(rows) > 1:
        return {
            "error": "several_match",
            "matches": [label(r) for r in rows[:8]],
            "instead": "ask which one they mean",
        }
    return rows[0]


def _name(r: Any) -> str:
    return str(getattr(r, "name", ""))


def _changes_line(before: dict[str, Any], after: dict[str, Any]) -> str:
    parts = []
    for k, v in after.items():
        was = before.get(k)
        if was != v:
            parts.append(
                f"{k.replace('_', ' ')} {was} → {v}"
                if was is not None
                else f"{k.replace('_', ' ')} {v}"
            )
    return ", ".join(parts)


def find_exercise(name: str, run: "Run") -> Any:
    return _one(_fx().exercises_like(run.ctx, name), "exercise", _name)


def find_template(name: str, run: "Run") -> Any:
    return _one(_fx().templates_like(run.ctx, name), "template", _name)


def find_food(name: str, run: "Run") -> Any:
    return _one(_fx().foods_like(run.ctx, name), "food", _name)


def removal_target(
    run: "Run", what: str, name: str
) -> tuple[list[str], str] | dict[str, Any]:
    """``remove_item`` by name for an exercise, template or food."""
    hit = {"exercise": find_exercise, "template": find_template, "food": find_food}[
        what
    ](name, run)
    if isinstance(hit, dict):
        return hit
    return [str(hit.id)], hit.name


def _in_workout(pairs: list[tuple[Any, str]], name: str) -> Any:
    hits = _fx().best_matches(name, [(we, n) for we, n in pairs])
    return _one(hits, "exercise_in_that_workout", lambda we: dict(pairs)[we])


# ------------------------------------------------------------- the tools


def fitness_tools(run: "Run", *, manage: Manage, card: Card) -> list[BaseTool]:
    ctx = run.ctx
    fx = _fx()
    # Foods each meal was given by this run. Seen live: a retry after a
    # refused call added the same polvoron to a lunch a second time.
    run_added: dict[str, set[str]] = {}

    def edit(
        entity: str, row_id: Any, label: str, changes: dict[str, Any], summary: str
    ) -> dict[str, Any]:
        out = manage("edit", entity, [str(row_id)], label, changes, "fitness", summary)
        if out.get("state") != "saved":
            # An edit saves at once; still waiting means the module refused.
            return out | {"error": "not_saved", "why": out.get("warn")}
        return out

    def find_fitness_logs(**kw: Any) -> dict[str, Any]:
        a = FindLogsArgs(**kw)
        day = ctx.clock.day_of
        if a.what == "exercises":
            return {"exercises": fx.list_exercises(ctx, a.query)}
        if a.what == "templates":
            return {"templates": fx.list_templates(ctx, a.query)}
        if a.what == "workouts":
            if a.id:
                w = fx.workout_by_id(ctx, a.id)
                return (
                    {"workout": fx.workout_public(ctx, w)}
                    if w
                    else {"error": "no_workout_with_that_id"}
                )
            rows = fx.recent_workouts(ctx, days=a.days)
            if len(rows) == 1:
                return {"workouts": [fx.workout_public(ctx, rows[0])]}
            return {
                "workouts": [
                    {
                        "id": str(w.id),
                        "day": day(w.started_at).isoformat(),
                        "name": w.name,
                        "status": w.status,
                        "exercises": [n for _, n in fx.workout_exercises(ctx, w)],
                    }
                    for w in rows
                ]
            }
        if a.what == "meals":
            meals = ports.fitness.recent_meals(ctx, days=a.days)
            if a.id:
                meals = [m for m in meals if str(m.id) == a.id]
            return {
                "meals": [
                    {
                        "id": str(m.id),
                        "day": day(m.eaten_at).isoformat(),
                        "label": m.label,
                        "said": m.raw_input[:80],
                        **(
                            {"items": fx.meal_items_public(ctx, m.id)}
                            if a.id or len(meals) <= 3
                            else {}
                        ),
                    }
                    for m in meals[:20]
                ]
            }
        return {
            "weigh_ins": [
                {
                    "id": str(x.id),
                    "day": day(x.measured_at).isoformat(),
                    "kg": x.weight_kg,
                    **({"body_fat_pct": x.body_fat_pct} if x.body_fat_pct else {}),
                }
                for x in ports.fitness.recent_weigh_ins(ctx, days=a.days)
            ]
        }

    def _exercise_changes(a: ExerciseFields) -> dict[str, Any]:
        ch: dict[str, Any] = {}
        for k in ("muscle", "equipment", "rep_min", "rep_max", "increment"):
            if getattr(a, k) is not None:
                ch[k] = getattr(a, k)
        if a.type is not None:
            ch["load_type"] = a.type
        if a.track is not None:
            ch["track"] = None if a.track == "none" else a.track
        return ch

    def create_exercise(**kw: Any) -> dict[str, Any]:
        a = ExerciseCreateArgs(**kw)
        same = [
            e
            for e in fx.exercises_like(ctx, a.name)
            if e.name.lower() == a.name.strip().lower()
        ]
        if same:
            return {
                "error": "an_exercise_with_that_name_exists",
                "exercise": same[0].name,
            }
        ch = {"name": a.name.strip()} | _exercise_changes(a)
        if ch.get("rep_min") and not ch.get("rep_max"):
            ch["rep_max"] = max(ch["rep_min"], 12)
        if ch.get("rep_max") and not ch.get("rep_min"):
            ch["rep_min"] = min(ch["rep_max"], 8)
        new_id = derived_id("exercise", ctx.user_id, "name:" + a.name.strip().lower())
        what = ", ".join(
            f"{k.replace('_', ' ')} {v}" for k, v in ch.items() if k != "name"
        )
        return edit(
            "exercise",
            new_id,
            a.name,
            ch,
            f"Created exercise: {a.name}{f' · {what}' if what else ''}",
        )

    def edit_exercise(**kw: Any) -> dict[str, Any]:
        a = ExerciseEditArgs(**kw)
        ex = find_exercise(a.exercise, run)
        if isinstance(ex, dict):
            return ex
        ch = _exercise_changes(a)
        if a.new_name and a.new_name.strip() != ex.name:
            taken = [
                e
                for e in fx.exercises_like(ctx, a.new_name)
                if e.name.lower() == a.new_name.strip().lower() and e.id != ex.id
            ]
            if taken:
                return {"error": "another_exercise_has_that_name"}
            ch["name"] = a.new_name.strip()
        if a.archived is not None:
            ch["archived"] = a.archived
        lo, hi = ch.get("rep_min", ex.rep_min), ch.get("rep_max", ex.rep_max)
        if hi < lo:
            return {
                "error": "rep_max_below_rep_min",
                "now": f"{ex.rep_min}-{ex.rep_max}",
            }
        if not ch:
            return {"error": "nothing_to_change"}
        before = {k: getattr(ex, k) for k in ch}
        verb = "Renamed exercise" if set(ch) == {"name"} else "Changed exercise"
        return edit(
            "exercise",
            ex.id,
            ex.name,
            ch,
            f"{verb}: {ex.name} · {_changes_line(before, ch)}",
        )

    def edit_workout_template(**kw: Any) -> dict[str, Any]:
        a = TemplateEditArgs(**kw)
        t = find_template(a.template, run)
        if isinstance(t, dict):
            return t
        now = fx.template_public(ctx, t)["exercises"]

        def slot(s: SlotArgs) -> dict[str, Any]:
            ex = fx.exercises_like(ctx, s.exercise)
            known = ex[0] if len(ex) == 1 else None
            out: dict[str, Any] = {
                "sets": s.sets,
                "target_sec": round(s.minutes * 60) if s.minutes else None,
            }
            if known is not None:
                out["exercise_id"] = str(known.id)
            else:
                out["exercise"] = s.exercise
            return out

        if a.exercises is not None:
            slots = [slot(s) for s in a.exercises]
        else:
            items = fx.template_slots(ctx, t)
            names: list[str | None] = [x["exercise"] for x in now]
            for r in a.remove:
                hits = fx.best_matches(
                    r, [(i, n) for i, n in enumerate(names) if n is not None]
                )
                if len(hits) != 1:
                    return {
                        "error": "not_in_that_template",
                        "exercise": r,
                        "template_has": names,
                    }
                names[hits[0]] = None
            slots = [it for it, n in zip(items, names, strict=True) if n is not None]
            slots += [slot(s) for s in a.add]
        ch: dict[str, Any] = {"items": slots}
        if a.new_name:
            ch["name"] = a.new_name
        if not slots:
            return {"error": "a_template_needs_an_exercise"}
        parts = []
        if a.new_name:
            parts.append(f"renamed to {a.new_name}")
        if a.add:
            parts.append("added " + ", ".join(s.exercise for s in a.add))
        if a.remove:
            parts.append("removed " + ", ".join(a.remove))
        if a.exercises is not None:
            parts.append(f"{len(slots)} exercises")
        return edit(
            "template",
            t.id,
            t.name,
            ch,
            f"Changed template: {t.name} · {'; '.join(parts) or 'updated'}",
        )

    def start_workout(**kw: Any) -> dict[str, Any]:
        a = StartArgs(**kw)
        live = fx.active_workout(ctx)
        if live is not None:
            return {
                "error": "a_workout_is_in_progress",
                "workout": live.name,
                "workout_id": str(live.id),
            }
        start: dict[str, Any] = {"source": "empty"}
        label = "Workout"
        if a.template:
            t = find_template(a.template, run)
            if isinstance(t, dict):
                return t
            start = {"source": "template", "template_id": str(t.id)}
            label = t.name
        elif a.repeat_last:
            last = fx.workout_by_id(ctx, None)
            if last is None:
                return {"error": "no_workout_to_repeat"}
            start = {"source": "repeat", "from_workout_id": str(last.id)}
            label = last.name
        return edit(
            "workout",
            uuid.uuid4(),
            label,
            {"start": start},
            f"Started workout: {label}",
        )

    def edit_workout(**kw: Any) -> dict[str, Any]:
        a = WorkoutEditArgs(**kw)
        w = fx.workout_by_id(ctx, a.workout_id)
        if w is None:
            return {
                "error": "no_workout_found",
                "instead": "look it up with find_fitness_logs",
            }
        pairs = fx.workout_exercises(ctx, w)
        ch: dict[str, Any] = {}
        said: list[str] = []

        def we_of(name: str) -> Any:
            return _in_workout(pairs, name)

        if a.new_name:
            ch["name"] = a.new_name
            said.append(f"renamed to {a.new_name}")
        if a.notes is not None:
            ch["notes"] = a.notes
            said.append("notes")
        for r in a.remove:
            we = we_of(r)
            if isinstance(we, dict):
                return we
            ch.setdefault("remove", []).append(str(we.id))
            said.append(f"removed {r}")
        sets_out: list[dict[str, Any]] = []
        for s in a.sets:
            we = we_of(s.exercise)
            if isinstance(we, dict):
                return we
            spec = s.model_dump(exclude_none=True, exclude={"exercise", "set"}) | {
                "we_id": str(we.id)
            }
            if s.set is not None:
                have = fx.sets_of(ctx, we.id)
                if s.set > len(have):
                    return {
                        "error": "no_such_set",
                        "exercise": s.exercise,
                        "sets": len(have),
                    }
                spec["set_id"] = str(have[s.set - 1].id)
                said.append(f"{s.exercise} set {s.set}")
            else:
                said.append(f"added a {s.exercise} set")
            sets_out.append(spec)
        if sets_out:
            ch["sets"] = sets_out
        for rs in a.remove_sets:
            we = we_of(rs.exercise)
            if isinstance(we, dict):
                return we
            have = fx.sets_of(ctx, we.id)
            if rs.set > len(have):
                return {
                    "error": "no_such_set",
                    "exercise": rs.exercise,
                    "sets": len(have),
                }
            ch.setdefault("remove_sets", []).append(
                {"we_id": str(we.id), "set_id": str(have[rs.set - 1].id)}
            )
            said.append(f"removed {rs.exercise} set {rs.set}")
        for sw in a.replace:
            we = we_of(sw.exercise)
            if isinstance(we, dict):
                return we
            ch.setdefault("replace", []).append({"we_id": str(we.id), "with": sw.to})
            said.append(f"{sw.exercise} → {sw.to}")
        for n in a.exercise_notes:
            we = we_of(n.exercise)
            if isinstance(we, dict):
                return we
            ch.setdefault("notes_for", []).append({"we_id": str(we.id), "note": n.note})
            said.append(f"note on {n.exercise}")
        for ad in a.add:
            if w.status == "finished" and not ad.sets:
                return {"error": "say_the_sets_done", "exercise": ad.exercise}
            ch.setdefault("add", []).append(
                {
                    "exercise": ad.exercise,
                    "sets": [s.model_dump(exclude_none=True) for s in ad.sets],
                }
            )
            said.append(
                f"added {ad.exercise}" + (f" ({len(ad.sets)} sets)" if ad.sets else "")
            )
        if a.order:
            ids = []
            for n_ in a.order:
                we = we_of(n_)
                if isinstance(we, dict):
                    return we
                ids.append(str(we.id))
            ch["order"] = ids
            said.append("reordered")
        if a.finish:
            if w.status != "in_progress":
                return {"error": "that_workout_is_already_finished"}
            ch["finish"] = "remove" if a.finish == "drop_unticked" else "done"
            said.append("finished")
        if not ch:
            return {"error": "nothing_to_change"}
        when = ctx.clock.day_of(w.started_at).isoformat()
        return edit(
            "workout",
            w.id,
            w.name,
            ch,
            f"Changed workout: {w.name} ({when}) · {'; '.join(said)}",
        )

    def _meal(meal_id: str) -> Any:
        rows = [
            m for m in ports.fitness.recent_meals(ctx, days=400) if str(m.id) == meal_id
        ]
        return (
            rows[0]
            if rows
            else {
                "error": "no_meal_with_that_id",
                "instead": "look it up with find_fitness_logs",
            }
        )

    def edit_meal(**kw: Any) -> dict[str, Any]:
        a = MealEditArgs(**kw)
        m = _meal(a.meal_id)
        if isinstance(m, dict):
            return m
        items = fx.meal_items_public(ctx, m.id)
        pairs = [(it["id"], it["name"]) for it in items]
        rows = {str(r.id): r for r in fx.meal_item_rows(ctx, m.id)}
        wrong: list[dict[str, Any]] = []

        def item_id(name: str) -> Any:
            hits = fx.best_matches(name, pairs)
            return _one(hits, "item_in_that_meal", lambda i: dict(pairs)[i])

        ch: dict[str, Any] = {}
        said: list[str] = []
        if a.label and a.label != m.label:
            ch["label"] = a.label
            said.append(f"moved to {a.label}")
        if a.day:
            ch["day"] = a.day.isoformat()
            said.append(f"moved to {a.day.isoformat()}")
        for r in a.remove_items:
            iid = item_id(r)
            if isinstance(iid, dict):
                return iid
            ch.setdefault("remove_items", []).append(iid)
            said.append(f"removed {r}")
        for e in a.edit_items:
            iid = item_id(e.item)
            if isinstance(iid, dict):
                return iid
            spec: dict[str, Any] = {"id": iid} | e.model_dump(
                exclude_none=True, exclude={"item", "new_name"}
            )
            if e.new_name:
                spec["name"] = e.new_name
            if len(spec) == 1:
                return {"error": "nothing_to_change", "item": e.item}
            row = rows.get(str(iid))
            touched = {k for k in spec if k in _ITEM_VALUES}
            if row is not None and touched:
                # A new amount rescales the stored values first (as the
                # edit itself does), then the named values replace them.
                f = float(e.qty) / row.qty if e.qty and row.qty > 0 else 1.0
                before = {
                    k: None if getattr(row, k) is None else getattr(row, k) * f
                    for k in _ITEM_VALUES
                }
                found = [
                    p
                    for p in ports.fitness.nutrient_check.value_problems(before | spec)
                    # An item already off before this edit (an old kcal-only
                    # entry) can still take a fix to something else.
                    if ports.fitness.nutrient_check.involves(p) & touched
                ]
                if found:
                    wrong.append({"item": e.item, "problems": found})
            ch.setdefault("edit_items", []).append(spec)
            said.append(
                f"{e.item}: "
                + ", ".join(f"{k} {v}" for k, v in spec.items() if k != "id")
            )
        done = run_added.setdefault(str(m.id), set())
        again = [it.name for it in a.add_items if it.name.strip().casefold() in done]
        for it in a.add_items:
            if it.name.strip().casefold() in done:
                continue
            found = ports.fitness.nutrient_check.estimate_problems(
                it.model_dump(exclude_none=True)
            )
            if found:
                wrong.append({"item": it.name, "problems": found})
            added = it.model_dump(exclude_none=True, exclude={"grams", "alcohol"})
            if it.grams:
                weight = f"about {it.grams:g} g"
                added["assumption"] = (
                    f"{it.assumption}, {weight}" if it.assumption else weight
                )
            ch.setdefault("add_items", []).append(added)
            said.append(f"added {it.name}")
        if wrong:
            return {"error": "fix_these_items_then_call_again", "items": wrong}
        if a.confirmed:
            ch["confirmed"] = True
            said.append("marked checked")
        when = ctx.clock.day_of(m.eaten_at).isoformat()
        if again:
            said.append(f"{', '.join(again)} already added")
        if not ch:
            if again:
                return {"summary": f"{m.label.capitalize()} ({when}) · {said[-1]}"}
            return {"error": "nothing_to_change"}
        out = edit(
            "meal",
            m.id,
            f"{m.label} {when}",
            ch,
            f"Changed {m.label} ({when}) · {'; '.join(said)}",
        )
        if "error" not in out:
            done.update(i["name"].strip().casefold() for i in ch.get("add_items", []))
            missing = ports.meal_missing_details(ch.get("add_items", []))
            if missing:
                out = out | {"saved_without": missing}
        return out

    def copy_meal(**kw: Any) -> dict[str, Any]:
        a = MealCopyArgs(**kw)
        m = _meal(a.meal_id)
        if isinstance(m, dict):
            return m
        items = [
            {
                k: v
                for k, v in {
                    "name": it.name,
                    "qty": it.qty,
                    "unit": it.unit,
                    "kcal": it.kcal,
                    "protein": it.protein,
                    "carbs": it.carbs,
                    "fat": it.fat,
                    "fiber": it.fiber,
                    "sat_fat": it.sat_fat,
                    "sugar": it.sugar,
                    "sodium": it.sodium,
                }.items()
                if v is not None
            }
            for it in fx.meal_item_rows(ctx, m.id)
        ]
        if not items:
            return {"error": "that_meal_has_no_items"}
        d = RecordDraft(
            kind="meal",
            target="fitness",
            rule="meal",
            confidence=1.0,
            day_offset=-a.days_ago,
            payload={
                "kind": "meal",
                "raw": m.raw_input or m.label,
                "label": m.label
                if m.label in ("breakfast", "lunch", "dinner", "snack")
                else meal_label(m.raw_input),
                "items": items,
                "confidence": 1.0,
            },
        )
        out = card(run, d)
        day_ = (ctx.today - timedelta(days=a.days_ago)).isoformat()
        kcal = round(sum(float(i["kcal"]) for i in items))
        return out | {
            "summary": f"Logged {m.label} again on {day_} · {len(items)} items, {kcal} kcal"
        }

    def edit_weigh_in(**kw: Any) -> dict[str, Any]:
        a = WeighEditArgs(**kw)
        rows = [
            x
            for x in ports.fitness.recent_weigh_ins(ctx, days=400)
            if str(x.id) == a.weigh_in_id
        ]
        if not rows:
            return {
                "error": "no_weigh_in_with_that_id",
                "instead": "look it up with find_fitness_logs",
            }
        x = rows[0]
        ch: dict[str, Any] = {}
        if a.kg is not None:
            ch["weight_kg"] = a.kg
        if a.body_fat_pct is not None:
            ch["body_fat_pct"] = a.body_fat_pct
        if a.note is not None:
            ch["note"] = a.note
        if a.day:
            local = x.measured_at.astimezone(ctx.clock.zone)
            ch["measured_at"] = datetime.combine(a.day, local.timetz()).isoformat()
        if not ch:
            return {"error": "nothing_to_change"}
        when = ctx.clock.day_of(x.measured_at).isoformat()
        shown = {
            ("day" if k == "measured_at" else k): (v[:10] if k == "measured_at" else v)
            for k, v in ch.items()
        }
        before = {
            "weight_kg": x.weight_kg,
            "body_fat_pct": x.body_fat_pct,
            "note": x.note,
            "day": when,
        }
        return edit(
            "weighIn",
            x.id,
            f"{x.weight_kg} kg on {when}",
            ch,
            f"Changed weigh-in ({when}) · {_changes_line(before, shown)}",
        )

    def set_macro_target(**kw: Any) -> dict[str, Any]:
        a = TargetArgs(**kw)
        ch = a.model_dump(exclude_none=True)
        if not ch:
            return {"error": "nothing_to_change"}
        now = fx.target_today(ctx)
        if now is None and not {"kcal", "protein", "carbs", "fat"} <= set(ch):
            return {"error": "no_target_yet_give_kcal_protein_carbs_and_fat"}
        return edit(
            "target",
            fx.target_row_id(ctx),
            "macro target",
            ch,
            f"Changed macro target from today · {_changes_line(now or {}, ch)}",
        )

    def fitness_settings(**kw: Any) -> dict[str, Any]:
        a = SettingsArgs(**kw)
        ch = a.model_dump(exclude_none=True, exclude={"reminder_off"})
        if a.reminder_off:
            ch["weigh_in_reminder"] = None
        if not ch:
            return {"error": "nothing_to_change"}
        row = fx.settings_row(ctx)
        before = {k: getattr(row, k) for k in ch}
        return edit(
            "settings",
            row.id,
            "fitness settings",
            ch,
            f"Changed fitness settings · {_changes_line(before, ch)}",
        )

    def edit_food(**kw: Any) -> dict[str, Any]:
        a = FoodEditArgs(**kw)
        f = find_food(a.food, run)
        if isinstance(f, dict):
            return f
        ch = a.model_dump(exclude_none=True, exclude={"food", "new_name"})
        if a.new_name:
            ch["name"] = a.new_name
        if not ch:
            return {"error": "nothing_to_change"}
        before = {k: getattr(f, k) for k in ch}
        return edit(
            "food",
            f.id,
            f.name,
            ch,
            f"Changed food: {f.name} · {_changes_line(before, ch)}",
        )

    specs: list[tuple[Callable[..., Any], type[BaseModel], str]] = [
        (
            find_fitness_logs,
            FindLogsArgs,
            "Look up fitness records with ids: recent meals (with items), "
            "weigh-ins, workouts (with numbered sets), exercises in the "
            "library, workout templates.",
        ),
        (create_exercise, ExerciseCreateArgs, "Add an exercise to the library."),
        (
            edit_exercise,
            ExerciseEditArgs,
            "Rename an exercise or change its muscle, equipment, type (timed "
            "or not), rep range, increment; or bring an archived one back.",
        ),
        (
            edit_workout_template,
            TemplateEditArgs,
            "Change a workout template: rename, add or remove exercises, "
            "reorder, sets, timed goals.",
        ),
        (
            start_workout,
            StartArgs,
            "Start a live workout, from a template, the last workout, or empty.",
        ),
        (
            edit_workout,
            WorkoutEditArgs,
            "Change a workout, live or past: rename, notes, add or remove "
            "exercises, add, edit or remove sets, swap or reorder exercises, "
            "or finish the one in progress.",
        ),
        (
            edit_meal,
            MealEditArgs,
            "Change a logged meal: move it to another meal or day, add, "
            "remove or resize items, fix an item's macros.",
        ),
        (copy_meal, MealCopyArgs, "Log a past meal again, today or another day."),
        (
            edit_weigh_in,
            WeighEditArgs,
            "Change a weigh-in's weight, body fat, day or note.",
        ),
        (
            set_macro_target,
            TargetArgs,
            "Change the daily macro target or a limit (saturated fat, sugar, "
            "sodium, fiber) from today; what is not given stays.",
        ),
        (
            fitness_settings,
            SettingsArgs,
            "Change fitness settings: units, rest time, workouts a week, "
            "weigh-in reminder, progression, weight goal.",
        ),
        (
            edit_food,
            FoodEditArgs,
            "Rename a saved food or change its numbers, basis or aliases.",
        ),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=desc, args_schema=schema
        )
        for fn, schema, desc in specs
    ]
