"""Offline unit tests for the AI module internals.

Everything here runs without network: LLM clients are constructed but never
invoked (or replaced by fakes), and LangGraph graphs are compiled/executed
in-process with a stubbed chat model.
"""

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from sqlmodel import Session, func, select

from app.core.config import settings
from app.modules.ai import llm as llm_module
from app.modules.ai.agents import repo as agent_repo
from app.modules.ai.agents.definitions import plan_and_execute as pe_module
from app.modules.ai.agents.definitions.fast import build_fast_agent
from app.modules.ai.agents.seed import DEFAULT_AGENTS, seed_agents
from app.modules.ai.tools import registry
from app.modules.ai.tools import repo as tool_repo
from app.modules.ai.tools.models import AgentTool, Tool
from app.modules.ai.tools.seed import seed_tools


class FakeChatModel:
    """Minimal stand-in for ChatOpenAI: fixed reply, counts invocations."""

    def __init__(self, content: str) -> None:
        self.content = content
        self.calls = 0

    async def ainvoke(self, messages: Any) -> AIMessage:  # noqa: ARG002
        self.calls += 1
        return AIMessage(content=self.content)


# --- llm.get_chat_model ---


def test_secret_wraps_only_non_none() -> None:
    assert llm_module._secret(None) is None
    wrapped = llm_module._secret("k")
    assert wrapped is not None
    assert wrapped.get_secret_value() == "k"


def test_get_chat_model_nebius(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "test-key-never-used")
    model = llm_module.get_chat_model("nebius")
    assert model.model_name == settings.NEBIUS_MODEL
    assert model.openai_api_base == settings.NEBIUS_BASE_URL


def test_get_chat_model_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key-never-used")
    model = llm_module.get_chat_model("openrouter", temperature=0.5)
    assert model.model_name == settings.OPENROUTER_MODEL
    assert model.openai_api_base == settings.OPENROUTER_BASE_URL
    assert model.temperature == 0.5


def test_get_chat_model_default_provider_from_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "NEBIUS_API_KEY", "test-key-never-used")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test-key-never-used")
    model = llm_module.get_chat_model()
    assert model.model_name in (settings.NEBIUS_MODEL, settings.OPENROUTER_MODEL)


def test_get_chat_model_unknown_provider_raises() -> None:
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        llm_module.get_chat_model("does-not-exist")


# --- tools registry ---


def test_registry_skips_disabled_brave_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "BRAVE_API_KEY", None)
    assert registry.get_langchain_tools(["brave_search"]) == []


def test_registry_builds_brave_search_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "BRAVE_API_KEY", "test-key")
    tools = registry.get_langchain_tools(["brave_search"])
    assert len(tools) == 1
    assert tools[0].name == "brave_search"


def test_registry_ignores_unknown_tool_names() -> None:
    assert registry.get_langchain_tools(["nope"]) == []


# --- agent graph builders (offline: fake chat model) ---


def test_fast_agent_graph_runs_with_fake_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeChatModel("hello back")
    monkeypatch.setattr(
        "app.modules.ai.agents.definitions.fast.get_chat_model", lambda **_: fake
    )
    graph = build_fast_agent().compile()
    state: Any = {"messages": [HumanMessage(content="hi")]}
    result = asyncio.run(graph.ainvoke(state))
    assert fake.calls == 1
    assert result["messages"][-1].content == "hello back"


def test_plan_and_execute_graph_structure_and_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeChatModel("1. first step\n2. second step\nno digit line")
    monkeypatch.setattr(pe_module, "get_chat_model", lambda **_: fake)
    monkeypatch.setattr(pe_module, "get_langchain_tools", lambda _names: [])

    graph = pe_module.build_plan_and_execute_agent()
    assert set(graph.nodes) >= {"create_plan", "execute_step"}

    state: Any = {"messages": [HumanMessage(content="do a thing")]}
    result = asyncio.run(graph.compile().ainvoke(state))
    assert result["plan"] == ["1. first step", "2. second step"]
    assert result["current_step"] == 2
    # one planning call + one llm call per plan step (no tools -> no executor)
    assert fake.calls == 3


def test_plan_and_execute_uses_react_executor_when_tools_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeChatModel("1. only step")

    class FakeExecutor:
        def __init__(self) -> None:
            self.calls = 0

        async def ainvoke(self, payload: dict[str, Any]) -> dict[str, Any]:
            self.calls += 1
            return {"messages": payload["messages"] + [AIMessage(content="executed")]}

    executor = FakeExecutor()
    monkeypatch.setattr(pe_module, "get_chat_model", lambda **_: fake)
    monkeypatch.setattr(pe_module, "get_langchain_tools", lambda _names: [object()])
    monkeypatch.setattr(pe_module, "create_react_agent", lambda *_a, **_k: executor)

    graph = pe_module.build_plan_and_execute_agent(tool_names=["brave_search"])
    state: Any = {"messages": [HumanMessage(content="go")]}
    result = asyncio.run(graph.compile().ainvoke(state))
    assert executor.calls == 1
    assert result["messages"][-1].content == "executed"


# --- router assembly ---


def test_ai_router_mounts_all_submodules() -> None:
    # Resolve the mounted paths through OpenAPI rather than walking
    # router.routes: newer Starlette records include_router() results as lazy
    # `_IncludedRouter` wrappers that carry no `.path`, so a substring check
    # over route.path silently matches nothing. app.openapi() flattens the
    # tree into real URL paths regardless of Starlette version.
    from fastapi import FastAPI

    from app.modules.ai.main import router

    assert router.prefix == "/ai"
    app = FastAPI()
    app.include_router(router)
    paths = list(app.openapi()["paths"])
    for fragment in ("/agents", "/tools", "/mcp", "/chat"):
        assert any(fragment in p for p in paths), fragment


# --- seeds (idempotency against the test DB) ---


def test_seed_agents_and_tools_are_idempotent(db: Session) -> None:
    seed_agents(db)
    seed_tools(db)

    for entry in DEFAULT_AGENTS:
        assert agent_repo.get_by_name(session=db, name=str(entry["name"])) is not None
    brave = tool_repo.get_by_name(session=db, name="brave_search")
    assert brave is not None
    react = agent_repo.get_by_name(session=db, name="react")
    assert react is not None
    link = tool_repo.get_agent_tool(session=db, agent_id=react.id, tool_id=brave.id)
    assert link is not None

    tool_count_before = db.exec(select(func.count()).select_from(Tool)).one()
    link_count_before = db.exec(select(func.count()).select_from(AgentTool)).one()

    # second run must not duplicate anything
    seed_agents(db)
    seed_tools(db)

    assert db.exec(select(func.count()).select_from(Tool)).one() == tool_count_before
    assert (
        db.exec(select(func.count()).select_from(AgentTool)).one() == link_count_before
    )
