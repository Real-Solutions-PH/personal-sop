"""The Expo request body: the app's own sound and the reminders channel."""

from app.shared.push import PushMessage, expo_message


def test_message_plays_the_unfurl_sound_on_the_reminders_channel() -> None:
    body = expo_message(PushMessage(token="ExponentPushToken[x]", title="T", body="B"))
    assert body["sound"] == "unfurl.wav"
    assert body["channelId"] == "reminders"
    assert "collapseId" not in body


def test_thread_sets_the_collapse_key() -> None:
    body = expo_message(
        PushMessage(token="ExponentPushToken[x]", title="T", body="B", thread="c1")
    )
    assert (body["threadId"], body["collapseId"]) == ("c1", "c1")


def test_a_push_from_fern_names_the_sender_and_may_be_edited_on_the_phone() -> None:
    """The iOS notification service extension adds Fern's picture: it needs
    ``mutableContent`` and finds the sender's name in ``data.fern``."""
    body = expo_message(
        PushMessage(
            token="ExponentPushToken[x]",
            title="Fern",
            body="B",
            data={"href": "/today"},
            fern="Fern",
        )
    )
    assert body["mutableContent"] is True
    assert body["data"] == {"href": "/today", "fern": "Fern"}


def test_other_pushes_are_left_as_they_are() -> None:
    body = expo_message(
        PushMessage(token="ExponentPushToken[x]", title="T", body="B", data={"a": 1})
    )
    assert "mutableContent" not in body
    assert body["data"] == {"a": 1}
