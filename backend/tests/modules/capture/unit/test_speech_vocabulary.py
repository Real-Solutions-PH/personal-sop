"""The key terms speech to text is told to expect, the Deepgram query that
carries them, and the tidy-up of what comes back."""

from app.modules.capture import seams, vocabulary


def test_a_stored_name_is_cut_to_what_is_said() -> None:
    assert (
        vocabulary.clean_name("Betagro Garlic Butter Tender Chicken Breast (90 g)")
        == "Betagro Garlic Butter Tender"
    )
    assert (
        vocabulary.clean_name("Canned sardines in tomato sauce, hot (red can)")
        == "Canned sardines"
    )
    assert vocabulary.clean_name("Pancit canton noodles with vegetables") == (
        "Pancit canton noodles"
    )
    assert vocabulary.clean_name("Reese's Sticks bar (42 g)") == "Reese's Sticks bar"
    assert vocabulary.clean_name("(only a note)") is None
    assert vocabulary.clean_name("Ab") is None


def test_fern_first_then_own_names_then_the_fixed_list_then_food() -> None:
    got = vocabulary.keyterms(
        ["Take isotretinoin", "Maya Black", "fern"], ["Quaker Quick Cook Oatmeal"]
    )
    assert got[:3] == ["Fern", "Take isotretinoin", "Maya Black"]
    assert got.count("Fern") == 1  # "fern" is the same word
    assert got.index("tapsilog") < got.index("Quaker Quick Cook Oatmeal")
    assert got[-1] == "Quaker Quick Cook Oatmeal"


def test_the_list_never_exceeds_deepgrams_budget() -> None:
    many = [f"Habit number {i:03d}" for i in range(300)]
    got = vocabulary.keyterms(many, many)
    assert len(got) <= vocabulary.MAX_TERMS
    assert sum(map(len, got)) <= vocabulary.MAX_CHARS
    assert got[0] == "Fern"
    short = vocabulary.keyterms([f"h{i}x" for i in range(300)])
    assert len(short) == vocabulary.MAX_TERMS


def test_the_deepgram_query_carries_each_key_term() -> None:
    assert seams.deepgram_params("nova-3", "tl", ["Fern", "Maya Black"]) == [
        ("model", "nova-3"),
        ("smart_format", "true"),
        ("language", "multi"),
        ("keyterm", "Fern"),
        ("keyterm", "Maya Black"),
    ]
    assert ("language", "en") in seams.deepgram_params("nova-3", None, [])
    assert not [
        k for k, _ in seams.deepgram_params("nova-3", "en", []) if k == "keyterm"
    ]


def test_another_countrys_peso_code_becomes_pesos() -> None:
    # As Nova-3's multi mode returned them on the test clips.
    assert seams.tidy_transcript("which will be MXN600000 from Real Solutions") == (
        "which will be ₱600,000 from Real Solutions"
    )
    assert seams.tidy_transcript("Log an expense of MXN 14,617.24, a refund") == (
        "Log an expense of ₱14,617.24, a refund"
    )
    assert seams.tidy_transcript("will be ARS600000.") == "will be ₱600,000."
    # "mga" (Tagalog), dollars and plain numbers are left alone.
    said = "Fern, MGA one hour, $1,600 on the 9th and 250 pesos"
    assert seams.tidy_transcript(said) == said


def test_request_urls_carrying_key_terms_stay_out_of_the_log() -> None:
    import logging

    import app.logger  # noqa: F401  (the server's logging set-up)

    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
