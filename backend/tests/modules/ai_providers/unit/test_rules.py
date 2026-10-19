"""Pure rules: base-URL policy, status mapping, model-list normalising, the
vision rule. Expected values are written by hand from the provider docs'
response shapes, never computed by the code under test."""

import pytest

from app.modules.ai_providers.rules import (
    PRESETS,
    BaseUrlRejected,
    code_for_status,
    normalise_models,
    validate_base_url,
    vision_allowed,
)

# --- base URL policy ---------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://api.example.com/v1", "https://api.example.com/v1"),
        ("https://api.example.com/v1/", "https://api.example.com/v1"),
        ("  https://API.Example.com:8443/v1  ", "https://api.example.com:8443/v1"),
        ("http://localhost:11434/v1", "http://localhost:11434/v1"),
        ("http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1"),
        ("HTTPS://host.test", "https://host.test"),
    ],
)
def test_base_url_accepted(raw: str, expected: str) -> None:
    assert validate_base_url(raw) == expected


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("http://api.example.com/v1", "base_url_scheme"),
        ("http://10.0.0.5:11434/v1", "base_url_scheme"),
        ("http://localhost.evil.com/v1", "base_url_scheme"),
        ("ftp://api.example.com", "base_url_scheme"),
        ("file:///etc/passwd", "base_url_scheme"),
        ("api.example.com/v1", "base_url_scheme"),
        ("https://user:pass@api.example.com/v1", "base_url_userinfo"),
        ("https://user@api.example.com/v1", "base_url_userinfo"),
        ("https://api.example.com@evil.com/v1", "base_url_userinfo"),
        ("http://localhost@evil.com/v1", "base_url_userinfo"),
        ("https://api.example.com/v1?key=sk", "base_url_invalid"),
        ("https://api.example.com/v1#frag", "base_url_invalid"),
        ("https://evil.com\\@api.example.com", "base_url_invalid"),
        ("https://api.exa mple.com", "base_url_invalid"),
        ("https://api.example.com/\nHost: x", "base_url_invalid"),
        ("https://", "base_url_invalid"),
        ("https://api.example.com:99999", "base_url_invalid"),
        ("", "base_url_invalid"),
        ("https://" + "a" * 250 + ".com", "base_url_invalid"),
    ],
)
def test_base_url_rejected(raw: str, code: str) -> None:
    with pytest.raises(BaseUrlRejected) as exc:
        validate_base_url(raw)
    assert exc.value.code == code
    # The error never quotes the submitted URL.
    assert raw.strip() == "" or raw.strip() not in str(exc.value)


# --- status mapping ----------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (200, "ok"),
        (204, "ok"),
        (301, "bad_response"),
        (302, "bad_response"),
        (400, "bad_response"),
        (401, "unauthorized"),
        (403, "unauthorized"),
        (404, "not_found"),
        (429, "rate_limited"),
        (500, "bad_response"),
        (503, "bad_response"),
    ],
)
def test_code_for_status(status: int, code: str) -> None:
    assert code_for_status(status) == code


# --- model list normalising --------------------------------------------------


def test_openrouter_shape_reads_modalities() -> None:
    payload = {
        "data": [
            {
                "id": "openai/gpt-4o-mini",
                "name": "OpenAI: GPT-4o-mini",
                "architecture": {"input_modalities": ["text", "image"]},
            },
            {
                "id": "meta-llama/llama-3.1-8b-instruct",
                "name": "Llama 3.1 8B",
                "architecture": {"input_modalities": ["text"]},
            },
            {
                "id": "x/legacy",
                "architecture": {"modality": "text+image->text"},
            },
        ]
    }
    result = normalise_models(payload)
    assert result is not None
    models, truncated = result
    assert not truncated
    assert [(m.id, m.name, m.supports_vision) for m in models] == [
        ("meta-llama/llama-3.1-8b-instruct", "Llama 3.1 8B", False),
        ("openai/gpt-4o-mini", "OpenAI: GPT-4o-mini", True),
        ("x/legacy", "x/legacy", True),
    ]


def test_metadata_false_beats_the_id_heuristic() -> None:
    # The id says gemini, but the provider says text only.
    payload = {
        "data": [{"id": "gemini-x", "architecture": {"input_modalities": ["text"]}}]
    }
    result = normalise_models(payload)
    assert result is not None
    assert result[0][0].supports_vision is False


def test_openai_shape_without_metadata_uses_id_heuristic_or_none() -> None:
    payload = {
        "object": "list",
        "data": [
            {"id": "gpt-4o", "object": "model", "owned_by": "openai"},
            {"id": "text-embedding-3-small", "object": "model"},
            {"id": "llava:13b", "object": "model"},
            {"id": "qwen2.5-vl-7b", "object": "model"},
        ],
    }
    result = normalise_models(payload)
    assert result is not None
    by_id = {m.id: m.supports_vision for m in result[0]}
    assert by_id == {
        "gpt-4o": True,
        "text-embedding-3-small": None,
        "llava:13b": True,
        "qwen2.5-vl-7b": True,
    }


def test_anthropic_display_name_and_bare_list() -> None:
    anthropic = {
        "data": [{"id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5"}]
    }
    together = [{"id": "Qwen/Qwen2.5-7B", "display_name": "Qwen 7B", "type": "chat"}]
    a = normalise_models(anthropic)
    t = normalise_models(together)
    assert a is not None and t is not None
    assert (a[0][0].name, a[0][0].supports_vision) == ("Claude Sonnet 4.5", True)
    assert (t[0][0].id, t[0][0].name, t[0][0].supports_vision) == (
        "Qwen/Qwen2.5-7B",
        "Qwen 7B",
        None,
    )


def test_junk_entries_skipped_and_duplicates_dropped() -> None:
    payload = {
        "data": [
            "string",
            {"name": "no id"},
            {"id": 7},
            {"id": "   "},
            {"id": "b"},
            {"id": "a", "name": "first"},
            {"id": "a", "name": "second"},
        ]
    }
    result = normalise_models(payload)
    assert result is not None
    assert [(m.id, m.name) for m in result[0]] == [("a", "first"), ("b", "b")]


@pytest.mark.parametrize(
    "payload", [{"error": "nope"}, {"data": "x"}, "text", 42, None, {"data": None}]
)
def test_not_a_model_list(payload: object) -> None:
    assert normalise_models(payload) is None


def test_truncates_at_the_cap() -> None:
    payload = {"data": [{"id": f"m{i:05d}"} for i in range(1005)]}
    result = normalise_models(payload)
    assert result is not None
    models, truncated = result
    assert truncated and len(models) == 1000
    assert models[0].id == "m00000" and models[-1].id == "m00999"


# --- vision rule -------------------------------------------------------------


@pytest.mark.parametrize(
    ("purpose", "claimed", "listed", "allowed"),
    [
        ("vision", True, None, True),
        ("vision", True, True, True),
        ("vision", False, None, False),
        ("vision", False, True, False),
        ("vision", True, False, False),
        ("chat", False, False, True),
        ("capture", False, None, True),
        ("transcription", True, False, True),
        ("advisor", False, None, True),
    ],
)
def test_vision_rule(
    purpose: str, claimed: bool, listed: bool | None, allowed: bool
) -> None:
    assert vision_allowed(purpose, claimed=claimed, listed=listed) is allowed


# --- presets -----------------------------------------------------------------


def test_presets_cover_every_provider_and_only_custom_takes_a_url() -> None:
    names = [p.name for p in PRESETS]
    assert names == [
        "openrouter",
        "openai",
        "anthropic",
        "gemini",
        "groq",
        "nebius",
        "together",
        "custom",
    ]
    for p in PRESETS:
        assert p.vision_models
        if p.name == "custom":
            assert p.custom_base_url and p.default_base_url is None
        else:
            assert not p.custom_base_url
            assert p.default_base_url and p.default_base_url.startswith("https://")


@pytest.mark.parametrize(
    "raw",
    [
        "http://localhost:11434/v1",
        "http://127.0.0.1:1234/v1",
        "https://10.0.0.5/v1",
        "https://192.168.1.20/v1",
        "https://169.254.169.254/latest",
        "https://[::1]/v1",
        "https://ollama.localhost/v1",
    ],
)
def test_private_hosts_refused_off_local(raw: str) -> None:
    with pytest.raises(BaseUrlRejected) as exc:
        validate_base_url(raw, allow_local=False)
    assert exc.value.code == "base_url_private"


def test_public_hosts_allowed_off_local() -> None:
    assert (
        validate_base_url("https://my-ollama.example.com/v1", allow_local=False)
        == "https://my-ollama.example.com/v1"
    )
    assert validate_base_url("http://localhost:11434/v1", allow_local=True)
