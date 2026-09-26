"""Plan and Execute agent: Creates a plan then executes steps."""

from typing import Any

from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import create_react_agent

from app.modules.ai.llm import get_chat_model
from app.modules.ai.tools.registry import get_langchain_tools


class PlanExecuteState(MessagesState):
    plan: list[str]
    current_step: int


def build_plan_and_execute_agent(
    config: dict[str, Any] | None = None, tool_names: list[str] | None = None
) -> StateGraph[PlanExecuteState, None]:
    llm = get_chat_model(**(config or {}))
    tools = get_langchain_tools(tool_names or [])

    async def create_plan(state: PlanExecuteState) -> dict[str, Any]:
        planning_prompt = (
            "You are a planning assistant. Given the user's request, "
            "create a step-by-step plan to accomplish it. "
            "Return each step on a new line, numbered. "
            "Keep the plan concise (3-5 steps max)."
        )
        messages = [{"role": "system", "content": planning_prompt}] + state["messages"]
        response = await llm.ainvoke(messages)
        content = response.content
        text = content if isinstance(content, str) else str(content)
        steps = [
            s.strip() for s in text.split("\n") if s.strip() and s.strip()[0].isdigit()
        ]
        return {"plan": steps, "current_step": 0, "messages": [response]}

    executor = create_react_agent(llm, tools) if tools else None

    async def execute_step(state: PlanExecuteState) -> dict[str, Any]:
        plan = state.get("plan", [])
        current_step = state.get("current_step", 0)
        if current_step >= len(plan):
            return {"messages": []}

        step = plan[current_step]
        step_message = {"role": "user", "content": f"Execute this step: {step}"}

        if executor:
            result = await executor.ainvoke(
                {"messages": state["messages"] + [step_message]}
            )
            new_messages = result["messages"][-1:]
        else:
            response = await llm.ainvoke(state["messages"] + [step_message])
            new_messages = [response]

        return {
            "messages": new_messages,
            "current_step": current_step + 1,
        }

    def should_continue(state: PlanExecuteState) -> str:
        if state.get("current_step", 0) >= len(state.get("plan", [])):
            return END
        return "execute_step"

    graph = StateGraph(PlanExecuteState)
    graph.add_node("create_plan", create_plan)
    graph.add_node("execute_step", execute_step)
    graph.set_entry_point("create_plan")
    graph.add_edge("create_plan", "execute_step")
    graph.add_conditional_edges(
        "execute_step",
        should_continue,
        {END: END, "execute_step": "execute_step"},
    )
    return graph
