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
