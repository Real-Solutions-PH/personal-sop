from sqlmodel import Session

from app.modules.ai.agents import repo as agent_repo
from app.modules.ai.tools import repo as tool_repo
from app.modules.ai.tools.models import Tool

DEFAULT_TOOLS: list[dict[str, object]] = [
    {
        "name": "brave_search",
        "description": "Web search using Brave Search API",
        "tool_type": "brave_search",
        "config": {},
        "is_active": True,
    },
]

TOOL_AGENT_ASSIGNMENTS: dict[str, list[str]] = {
    "brave_search": ["react", "plan_and_execute"],
}


def seed_tools(session: Session) -> None:
    for entry in DEFAULT_TOOLS:
        name = str(entry["name"])
        if tool_repo.get_by_name(session=session, name=name) is None:
            tool_repo.create(session=session, tool=Tool(**entry))

    for tool_name, agent_names in TOOL_AGENT_ASSIGNMENTS.items():
        tool = tool_repo.get_by_name(session=session, name=tool_name)
        if tool is None:
            continue
        for agent_name in agent_names:
            agent = agent_repo.get_by_name(session=session, name=agent_name)
            if agent is None:
                continue
            existing = tool_repo.get_agent_tool(
                session=session, agent_id=agent.id, tool_id=tool.id
            )
            if existing is None:
                tool_repo.assign_tool_to_agent(
                    session=session, agent_id=agent.id, tool_id=tool.id
                )
