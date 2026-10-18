"""``e1rm`` and the JS-compatible number formatting against the prototype."""

from app.modules.fitness import calc as C
from tests.modules.fitness.unit.golden import load

FX = load("fitness-e1rm")["data"]


def test_e1rm_grid() -> None:
    assert len(FX["cases"]) == 72
    for c in FX["cases"]:
        assert C.e1rm(c["load"], c["reps"]) == c["e1rm"], c


def test_kg_formatting_rounds_like_to_fixed() -> None:
    for c in FX["fmt"]:
        assert C.kg(c["n"]) == c["kg"], c
        assert C.kg_short(c["n"]) == c["kgShort"], c


def test_volume_formatting() -> None:
    for c in FX["vol"]:
        assert C.fmt_volume(c["n"]) == c["fmt"], c


def test_js_round_is_half_up_not_bankers() -> None:
    assert C.js_round(2.5) == 3
    assert C.js_round(-2.5) == -2
    assert C.js_round(0.5) == 1
