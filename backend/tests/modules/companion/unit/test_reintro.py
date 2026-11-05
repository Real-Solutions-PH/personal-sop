"""Which hidden parts Fern offers to bring back, once."""

from app.modules.companion import reintro


def test_a_feeling_touches_the_journal_and_an_entry_its_module() -> None:
    assert reintro.heard("felt anxious today", []) == ["journal"]
    assert reintro.heard("I feel like pizza tonight", []) == ["journal"]
    assert reintro.heard("the felt pen is gone", []) == []
    assert reintro.heard("log a 5k run", []) == []
    assert reintro.heard("feeling really overwhelmed", ["tasks"]) == [
        "tasks",
        "journal",
    ]
    assert reintro.heard("spent 200 on lunch", ["finance", "finance"]) == ["finance"]


def test_offered_once_and_never_after_not_for_me() -> None:
    kw = {"hidden": ["journal", "finance"], "offered": [], "dismissed": []}
    assert reintro.to_offer(["journal", "tasks"], **kw) == ["journal"]
    assert reintro.to_offer(["journal"], **{**kw, "offered": ["journal"]}) == []
    assert reintro.to_offer(["finance"], **{**kw, "dismissed": ["finance"]}) == []


def test_the_block_says_what_the_part_adds() -> None:
    assert reintro.block("journal") == {
        "t": "module_intro",
        "module": "journal",
        "text": "Journal is hidden. It keeps a daily mood check-in and notes "
        "like this one. Want it back?",
    }
