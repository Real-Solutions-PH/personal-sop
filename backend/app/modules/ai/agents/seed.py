from sqlmodel import Session

from app.modules.ai.agents import repo as agent_repo
from app.modules.ai.agents.models import Agent

DEFAULT_AGENTS: list[dict[str, object]] = [
    {
        "name": "fast",
        "description": "Simple direct LLM call - fastest response, no tools",
        "config": {},
        "is_active": True,
    },
    {
        "name": "react",
        "description": "ReAct agent with tool calling capability",
        "config": {},
        "is_active": True,
    },
    {
        "name": "plan_and_execute",
        "description": "Planning agent that creates a plan then executes steps",
        "config": {},
        "is_active": True,
    },
]


def seed_agents(session: Session) -> None:
    for entry in DEFAULT_AGENTS:
        name = str(entry["name"])
        if agent_repo.get_by_name(session=session, name=name) is None:
            agent_repo.create(session=session, agent=Agent(**entry))
