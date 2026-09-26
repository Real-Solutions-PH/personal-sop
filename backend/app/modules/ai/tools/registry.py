from langchain_community.tools import BraveSearch
from langchain_core.tools import BaseTool

from app.core.config import settings


def _build_brave_search() -> BaseTool | None:
    if not settings.brave_search_enabled or settings.BRAVE_API_KEY is None:
        return None
    return BraveSearch.from_api_key(
        api_key=settings.BRAVE_API_KEY,
        search_kwargs={"count": 3},
    )


TOOL_BUILDERS: dict[str, object] = {
    "brave_search": _build_brave_search,
}


def get_langchain_tools(tool_names: list[str]) -> list[BaseTool]:
    """Instantiate LangChain tools by their registry names."""
    tools: list[BaseTool] = []
    for name in tool_names:
        builder = TOOL_BUILDERS.get(name)
        if callable(builder):
            tool = builder()
            if tool is not None:
                tools.append(tool)
    return tools
