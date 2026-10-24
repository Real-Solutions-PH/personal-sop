"""One reply at a time in a chat (``gate``): against the real Redis."""

import threading
import time
import uuid

from app.modules.companion import gate


def test_a_second_reply_waits_until_the_first_frees_the_chat() -> None:
    user, thread = uuid.uuid4(), "chat-1"
    holding, release = threading.Event(), threading.Event()
    order: list[str] = []
    waited: list[str] = []

    def first() -> None:
        with gate.turn_slot(user, thread, "run-1"):
            order.append("first in")
            holding.set()
            release.wait(5)
            order.append("first out")

    def second() -> None:
        with gate.turn_slot(user, thread, "run-2", on_wait=waited.append):
            order.append("second in")

    a = threading.Thread(target=first)
    a.start()
    assert holding.wait(5)
    b = threading.Thread(target=second)
    b.start()
    # The second is blocked while the first holds the chat...
    time.sleep(0.6)
    assert order == ["first in"] and waited == ["run-1"]
    # ...and goes as soon as it is freed.
    release.set()
    a.join(5)
    b.join(5)
    assert order == ["first in", "first out", "second in"]


def test_other_chats_and_other_people_do_not_wait() -> None:
    user = uuid.uuid4()
    with gate.turn_slot(user, "chat-1", "run-1"):
        with gate.turn_slot(user, "chat-2", "run-2"):
            pass
        with gate.turn_slot(uuid.uuid4(), "chat-1", "run-3"):
            pass


def test_a_stop_is_only_heard_by_that_persons_reply() -> None:
    me, other = uuid.uuid4(), uuid.uuid4()
    gate.request_stop(me, "run-1")
    assert gate.stop_requested(me, "run-1")
    assert not gate.stop_requested(other, "run-1")
    # The reply's slot clears its stop flag when it ends.
    with gate.turn_slot(me, "chat-1", "run-1"):
        pass
    assert not gate.stop_requested(me, "run-1")
