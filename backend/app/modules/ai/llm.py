from typing import Any

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from app.core.config import settings


def _secret(value: str | None) -> SecretStr | None:
    return SecretStr(value) if value is not None else None


def get_chat_model(provider: str | None = None, **kwargs: Any) -> ChatOpenAI:
    """Return a LangChain ChatModel for the specified provider.

    Both Nebius AI and OpenRouter expose OpenAI-compatible APIs,
    so ChatOpenAI works for both with different base_url/api_key.
    """
    provider = provider or settings.DEFAULT_LLM_PROVIDER

    if provider == "nebius":
        return ChatOpenAI(
            model=settings.NEBIUS_MODEL,
            api_key=_secret(settings.NEBIUS_API_KEY),
            base_url=settings.NEBIUS_BASE_URL,
            **kwargs,
        )
    elif provider == "openrouter":
        return ChatOpenAI(
            model=settings.OPENROUTER_MODEL,
            api_key=_secret(settings.OPENROUTER_API_KEY),
            base_url=settings.OPENROUTER_BASE_URL,
            **kwargs,
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}")
