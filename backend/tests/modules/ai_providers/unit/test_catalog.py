"""The Nebius catalogue the app offers on the server's key."""

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.modules.ai_providers import catalog
from app.modules.capture.schema import AISettingsUpdate


def test_ids_are_unique_and_kinds_known() -> None:
    ids = [m.id for m in catalog.NEBIUS]
    assert len(ids) == len(set(ids))
    assert all(m.kind in ("text", "vision") for m in catalog.NEBIUS)
    assert all(0 < m.usd_in <= m.usd_out for m in catalog.NEBIUS)


def test_server_defaults_are_offered_and_fit_their_purpose() -> None:
    text = catalog.find(settings.NEBIUS_MODEL)
    photo = catalog.find(settings.NEBIUS_VISION_MODEL)
    assert text is not None
    assert photo is not None and photo.kind == "vision"


def test_settings_accept_only_an_offered_model() -> None:
    assert AISettingsUpdate(model="zai-org/GLM-5.3").model == "zai-org/GLM-5.3"
    assert AISettingsUpdate(model=None).model is None  # back to the default
    with pytest.raises(ValidationError) as err:
        AISettingsUpdate(model="someone/else-model")
    assert "someone/else-model" not in str(err.value.errors()[0]["msg"])
