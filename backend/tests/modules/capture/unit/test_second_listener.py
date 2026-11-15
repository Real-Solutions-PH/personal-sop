"""The second listener (ADR-0016, 2026-11-14): an audio model hears WAV
and MP3 recordings alongside Deepgram, and its words are used only when
they are about as long as Deepgram's."""

import json
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.modules.ai_providers import public as ai
from app.modules.capture import seams

DG_HOST = "deepgram.test"
OR_HOST = "openrouter.test"


def resolved(source: str = "server") -> ai.ResolvedModel:
    return ai.ResolvedModel(
        purpose="transcription",
        provider="deepgram",
        model="nova-3",
        base_url=f"https://{DG_HOST}/v1",
        api_key=SecretStr("k"),
        credential_id=None,
        supports_vision=False,
        source=source,  # type: ignore[arg-type]
    )


@pytest.fixture
def on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(seams.settings, "STT_CHECK_ENABLED", True)
    monkeypatch.setattr(seams.settings, "STT_CHECK_MODEL", "google/gemini-3.8-flash")
    monkeypatch.setattr(seams.settings, "STT_CHECK_REASONING", "minimal")
    monkeypatch.setattr(seams.settings, "OPENROUTER_API_KEY", "or-key")
    monkeypatch.setattr(seams.settings, "OPENROUTER_BASE_URL", f"https://{OR_HOST}/v1")


def fake(
    monkeypatch: pytest.MonkeyPatch,
    deepgram: httpx.Response,
    check: httpx.Response,
) -> list[httpx.Request]:
    """Both providers answer from canned responses; returns the requests."""
    seen: list[httpx.Request] = []
    real = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return deepgram if request.url.host == DG_HOST else check

    def client(**kw: Any) -> httpx.Client:
        kw.pop("trust_env", None)
        return real(transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(seams.httpx, "Client", client)
    return seen


def dg_words(text: str) -> httpx.Response:
    body = {"results": {"channels": [{"alternatives": [{"transcript": text}]}]}}
    return httpx.Response(200, json=body)


def check_words(text: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def run(mime: str = "audio/wav", source: str = "server") -> str:
    return seams.transcribe(
        resolved(source),
        b"RIFF....WAVE",
        filename="d",
        mime=mime,
        language="tl",
        keyterms=["Fern", "Maya Black"],
    )


# As heard on the test clips (r08, r01): Deepgram's then the audio model's.
DG = "Move all of the scheduled income from my black to my savings."
CHECK = "Move all of the scheduled income from Maya Black to Maya Savings."


@pytest.mark.usefixtures("on")
def test_the_second_listeners_words_win_when_they_are_about_as_long(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = fake(monkeypatch, dg_words(DG), check_words(CHECK))
    assert run() == CHECK
    sent = json.loads(next(r for r in seen if r.url.host == OR_HOST).content)
    assert sent["model"] == "google/gemini-3.8-flash"
    assert sent["reasoning"] == {"effort": "minimal"}
    prompt = sent["messages"][0]["content"][0]["text"]
    assert "Fern, Maya Black" in prompt
    assert sent["messages"][0]["content"][1]["input_audio"]["format"] == "wav"


@pytest.mark.usefixtures("on")
@pytest.mark.parametrize(
    "check",
    [
        "Move all of the",  # stopped mid-sentence (0.31 of Deepgram's length)
        CHECK + " " + CHECK,  # said it twice (2.0)
        "",
    ],
)
def test_a_cut_short_or_padded_answer_keeps_deepgrams_words(
    monkeypatch: pytest.MonkeyPatch, check: str
) -> None:
    fake(monkeypatch, dg_words(DG), check_words(check))
    assert run() == DG


@pytest.mark.usefixtures("on")
def test_a_failing_second_listener_keeps_deepgrams_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake(monkeypatch, dg_words(DG), httpx.Response(502, json={}))
    assert run() == DG


@pytest.mark.usefixtures("on")
def test_a_label_before_the_words_is_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake(monkeypatch, dg_words(DG), check_words('Transcript: "' + CHECK + '"'))
    assert run() == CHECK


@pytest.mark.usefixtures("on")
def test_deepgram_failing_fails_whatever_the_second_listener_says(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A header-only WAV: Deepgram refuses it, an audio model may still
    # "hear" something. The phone's own words must stay instead.
    refused = httpx.Response(
        400,
        json={
            "err_code": "Bad Request",
            "err_msg": "Bad Request: failed to process audio: corrupt or "
            "unsupported data",
        },
    )
    fake(monkeypatch, refused, check_words("Thank you for watching."))
    with pytest.raises(seams.SeamError) as err:
        run()
    assert err.value.code == "transcription_failed"


@pytest.mark.usefixtures("on")
def test_silence_stays_silence(monkeypatch: pytest.MonkeyPatch) -> None:
    fake(monkeypatch, dg_words(""), check_words("Thank you for watching."))
    assert run() == ""


@pytest.mark.usefixtures("on")
@pytest.mark.parametrize(
    ("mime", "source"),
    [
        ("audio/mp4", "server"),  # a format it does not take
        ("audio/wav", "user"),  # the person's own Deepgram key
    ],
)
def test_only_the_servers_key_and_formats_it_takes_get_a_second_listener(
    monkeypatch: pytest.MonkeyPatch, mime: str, source: str
) -> None:
    seen = fake(monkeypatch, dg_words(DG), check_words(CHECK))
    assert run(mime, source) == DG
    assert [r.url.host for r in seen] == [DG_HOST]
    assert not seams.checked(resolved(source), mime)


def test_switched_off_or_no_model_or_no_key_means_deepgram_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(seams.settings, "OPENROUTER_API_KEY", "or-key")
    monkeypatch.setattr(seams.settings, "STT_CHECK_MODEL", "google/gemini-3.8-flash")
    monkeypatch.setattr(seams.settings, "STT_CHECK_ENABLED", True)
    assert seams.checked(resolved(), "audio/wav")
    monkeypatch.setattr(seams.settings, "STT_CHECK_ENABLED", False)
    assert not seams.checked(resolved(), "audio/wav")
    monkeypatch.setattr(seams.settings, "STT_CHECK_ENABLED", True)
    monkeypatch.setattr(seams.settings, "STT_CHECK_MODEL", "")
    assert not seams.checked(resolved(), "audio/wav")
    monkeypatch.setattr(seams.settings, "STT_CHECK_MODEL", "google/gemini-3.8-flash")
    monkeypatch.setattr(seams.settings, "OPENROUTER_API_KEY", None)
    assert not seams.checked(resolved(), "audio/wav")


def test_the_second_listener_is_metered() -> None:
    plain = ai.transcription_minor("deepgram", 60, keyterms=True)
    both = ai.transcription_minor("deepgram", 60, keyterms=True, checked=True)
    # $0.0056 -> 32 centavos; plus $0.0045 = $0.0101 -> 58 centavos.
    assert (plain, both) == (32, 58)
