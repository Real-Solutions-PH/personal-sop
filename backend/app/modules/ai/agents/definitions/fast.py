"""Fast agent: Simple direct LLM call, no tools, fastest response."""

from typing import Any

from langgraph.graph import END, MessagesState, StateGraph

from app.modules.ai.llm import get_chat_model


def build_fast_agent(
    config: dict[str, Any] | None = None,
) -> StateGraph[MessagesState, None]:
    llm = get_chat_model(**(config or {}))

    async def call_model(state: MessagesState) -> dict[str, Any]:
        response = await llm.ainvoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("model", call_model)
    graph.set_entry_point("model")
    graph.add_edge("model", END)
    return graph
