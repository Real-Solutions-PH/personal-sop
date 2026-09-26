"""ReAct agent: Uses tool calling in a reasoning loop."""

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.prebuilt import create_react_agent

from app.modules.ai.llm import get_chat_model
from app.modules.ai.tools.registry import get_langchain_tools


def build_react_agent(
    config: dict[str, Any] | None = None,
    tool_names: list[str] | None = None,
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> Any:
    """Build a ReAct agent with tool calling capability.

    Returns a CompiledStateGraph (from create_react_agent).
    """
    llm = get_chat_model(**(config or {}))
    tools = get_langchain_tools(tool_names or [])
    return create_react_agent(llm, tools, checkpointer=checkpointer)
