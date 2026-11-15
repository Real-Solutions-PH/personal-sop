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


def _fake_deepgram(monkeypatch, answer):  # type: ignore[no-untyped-def]
    """Every ``httpx.Client`` the seam opens answers with ``answer(request)``;
    returns the key terms each request carried."""
    import httpx

    sent: list[list[str]] = []
    real = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.url.params.get_list("keyterm"))
        return answer(request)

    def client(**kw):  # type: ignore[no-untyped-def]
        kw.pop("trust_env", None)
        return real(transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(seams.httpx, "Client", client)
    monkeypatch.setattr(seams.settings, "STT_CHECK_ENABLED", False)  # Deepgram alone
    return sent


def _resolved():  # type: ignore[no-untyped-def]
    from pydantic import SecretStr

    from app.modules.ai_providers import public as ai

    return ai.ResolvedModel(
        purpose="transcription",
        provider="deepgram",
        model="nova-3",
        base_url="https://deepgram.test/v1",
        api_key=SecretStr("k"),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def _words(text: str):  # type: ignore[no-untyped-def]
    import httpx

    body = {"results": {"channels": [{"alternatives": [{"transcript": text}]}]}}
    return httpx.Response(200, json=body)


def test_a_key_term_list_over_deepgrams_limit_is_halved_not_failed(
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    import httpx

    # As Deepgram answered a 77-name list in ``multi`` on 2026-11-14.
    def answer(request: httpx.Request) -> httpx.Response:
        if len(request.url.params.get_list("keyterm")) > 10:
            return httpx.Response(
                400,
                json={
                    "err_code": "Bad Request",
                    "err_msg": "Bad Request: Keyterm limit exceeded. The maximum "
                    "number of tokens across all keyterms is 500.",
                },
            )
        return _words("Fern, log my adobo")

    sent = _fake_deepgram(monkeypatch, answer)
    terms = ["Fern", *[f"Name {i}" for i in range(39)]]
    got = seams.transcribe(
        _resolved(),
        b"RIFF",
        filename="d",
        mime="audio/wav",
        language="tl",
        keyterms=terms,
    )
    assert got == "Fern, log my adobo"
    assert [len(s) for s in sent] == [40, 20, 10]
    assert sent[-1] == terms[:10]  # the first names are the ones kept


def test_any_other_refusal_fails_and_logs_deepgrams_reason(
    monkeypatch,
    caplog,  # type: ignore[no-untyped-def]
) -> None:
    import logging

    import httpx
    import pytest

    def answer(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "err_code": "Bad Request",
                "err_msg": "Bad Request: failed to process audio: corrupt or "
                "unsupported data",
            },
        )

    sent = _fake_deepgram(monkeypatch, answer)
    with caplog.at_level(logging.WARNING), pytest.raises(seams.SeamError) as err:
        seams.transcribe(
            _resolved(),
            b"RIFF0000",
            filename="d",
            mime="audio/wav",
            language="tl",
            keyterms=["Fern", "Maya Black"],
        )
    assert err.value.code == "transcription_failed"
    assert len(sent) == 1  # not a key-term refusal: no retry
    logged = caplog.text
    assert "corrupt or unsupported data" in logged
    assert "audio/wav, 8 bytes" in logged
    assert "Maya Black" not in logged  # the names never reach the log
