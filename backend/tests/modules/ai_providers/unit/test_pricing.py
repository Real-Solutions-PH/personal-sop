"""AI spend is priced from each model's own rate (the catalogue), converted
to centavos at ``AI_USD_TO_PHP``. Expected values are worked by hand."""

import pytest

from app.core.config import settings
from app.modules.ai_providers import public as ai


@pytest.fixture(autouse=True)
def fx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_USD_TO_PHP", 57.0)


def test_a_chat_call_costs_its_models_catalogue_price() -> None:
    # Qwen3 30B: $0.10 in / $0.30 out per million tokens.
    # 1,000,000 in + 100,000 out = $0.10 + $0.03 = $0.13 = P7.41 = 741.
    assert ai.price_minor("Qwen/Qwen3-30B-A3B-Instruct-2507", 1_000_000, 100_000) == 741
    # A typical Fern turn: 5,000 in + 60 out = $0.000518 = P0.0295 -> 3.
    assert ai.price_minor("Qwen/Qwen3-30B-A3B-Instruct-2507", 5_000, 60) == 3


def test_any_call_that_moved_tokens_costs_at_least_a_centavo() -> None:
    assert ai.price_minor("Qwen/Qwen3-30B-A3B-Instruct-2507", 1, 0) == 1
    assert ai.price_minor("Qwen/Qwen3-30B-A3B-Instruct-2507", 0, 0) == 0


def test_an_unlisted_model_uses_the_generous_fallback() -> None:
    # $1 / $3 per million: 1,000,000 in = $1.00 = P57.00 = 5,700.
    assert ai.price_minor("someone/custom-model", 1_000_000, 0) == 5_700


def test_transcription_is_charged_by_the_second() -> None:
    # Deepgram $0.0043/min: 60 s = $0.0043 = P0.2451 -> 25; 6 s -> 3.
    assert ai.transcription_minor("deepgram", 60) == 25
    assert ai.transcription_minor("deepgram", 6) == 3
    # Whisper-style $0.006/min: 60 s = $0.006 = P0.342 -> 35.
    assert ai.transcription_minor("openai", 60) == 35
