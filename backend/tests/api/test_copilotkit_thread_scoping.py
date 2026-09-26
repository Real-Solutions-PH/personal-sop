"""AG-UI chat threads are scoped to the authenticated (tenant, user).

The AG-UI ``thread_id`` is the sole key the LangGraph checkpointer stores
conversation state under, and it arrives from the client. Without scoping,
any caller who supplies another caller's ``thread_id`` reads or resumes that
conversation. The run handler namespaces the id with the caller's
``{tenant}:{user}::`` prefix before it reaches the graph.

The pure-function tests below need no infrastructure. The HTTP tests reuse
the fake-agent harness (no LLM) and require the auth stack for tokens.
"""

import uuid

import pytest
from fastapi import HTTPException, status

from app.modules.ai.copilotkit.routes import _NS_SEP, _namespace_thread_id


def _ids() -> tuple[uuid.UUID, uuid.UUID]:
    return uuid.uuid4(), uuid.uuid4()


def test_bare_client_id_is_prefixed_with_caller_namespace() -> None:
    tenant, user = _ids()
    out = _namespace_thread_id("chat-1", tenant, user)
    assert out == f"{tenant}:{user}{_NS_SEP}chat-1"


def test_own_prefixed_id_round_trips_unchanged() -> None:
    # The prefixed id is echoed to the client in RUN_STARTED/RUN_FINISHED and
    # sent back on the next turn; it must not be prefixed a second time or the
    # conversation would fork to a new checkpointer thread every message.
    tenant, user = _ids()
    already = f"{tenant}:{user}{_NS_SEP}chat-1"
    assert _namespace_thread_id(already, tenant, user) == already


def test_empty_id_gets_a_fresh_namespaced_id() -> None:
    tenant, user = _ids()
    out = _namespace_thread_id("", tenant, user)
    assert out.startswith(f"{tenant}:{user}{_NS_SEP}")
    # a real, non-empty suffix was generated
    assert out.split(_NS_SEP, 1)[1]


def test_two_callers_sharing_a_client_id_get_isolated_threads() -> None:
    tenant_a, user_a = _ids()
    tenant_b, user_b = _ids()
    a = _namespace_thread_id("same-id", tenant_a, user_a)
    b = _namespace_thread_id("same-id", tenant_b, user_b)
    assert a != b


def test_foreign_namespaced_id_is_rejected() -> None:
    tenant, user = _ids()
    other_tenant, other_user = _ids()
    foreign = f"{other_tenant}:{other_user}{_NS_SEP}chat-1"
    with pytest.raises(HTTPException) as exc:
        _namespace_thread_id(foreign, tenant, user)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN


def test_id_carrying_the_namespace_marker_but_no_prefix_is_rejected() -> None:
    # Defensive: anything wearing our "::" boundary that is not the caller's
    # own prefix cannot be trusted as a bare client id.
    tenant, user = _ids()
    with pytest.raises(HTTPException) as exc:
        _namespace_thread_id(f"forged{_NS_SEP}thread", tenant, user)
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN
