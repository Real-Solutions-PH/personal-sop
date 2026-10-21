"""Where the server deliberately differs from the prototype, pinned by hand,
and the small pure helpers."""

from app.modules.capture import parse as P
from app.modules.capture import seams
from app.modules.capture.cards import js_parse_float
from app.modules.capture.photo import receipt_text
from app.shared.currency import money
from tests.modules.capture.unit.golden import load, world_from

WORLD = world_from(load("capture-parse")["data"]["world"])


def test_a_thousands_separator_never_splits_a_segment() -> None:
    # The prototype read this as P2 + P499 (two expenses).
    [d] = P.parse_capture(WORLD, "bought shoes 2,499 on shopee", P.ParseCtx())
    assert isinstance(d, P.RecordDraft)
    assert (
        d.payload["amount_minor"] == 249_900 and d.payload["category_id"] == "shopping"
    )
    [inc] = P.parse_capture(WORLD, "salary 42,000 to bpi", P.ParseCtx())
    assert isinstance(inc, P.RecordDraft)
    assert (inc.kind, inc.payload["amount_minor"], inc.payload["account_id"]) == (
        "income",
        4_200_000,
        "bpi",
    )
    # a list still splits on its commas
    segs = P.segment(WORLD, "coffee 165, grab 250")
    assert [s.seg for s in segs] == ["coffee 165", "grab 250"]
    assert [s.seg for s in P.segment(WORLD, "spent 1,500, then 2 coffees")][
        0
    ] == "spent 1,500"


def test_receipt_text_takes_the_total_line() -> None:
    assert (
        receipt_text("PUREGOLD\nSUBTOTAL 1,100.00\nVAT 140.00\nTOTAL 1,240.00")
        == "PUREGOLD 1240"
    )
    assert receipt_text("Mercury Drug\nItem 120\nItem 366") == "Mercury Drug 366"
    assert receipt_text("") == ""


def test_money_and_cost() -> None:
    assert money(124_050) == "₱1,241"
    assert money(124_049) == "₱1,240"
    assert money(-500) == "₱-5"
    assert seams.estimate_cost(0, 0) == 0
    assert seams.estimate_cost(1, 1) == 1  # never free once tokens moved
    assert seams.estimate_cost(10_000, 2_000) == 200


def test_js_parse_float() -> None:
    assert js_parse_float("1.5 cups") == 1.5
    assert js_parse_float("half") is None
    assert js_parse_float(" 2") == 2.0
