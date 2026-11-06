import os
import tempfile
from pathlib import Path

import pytest

from app.modules.fitness.food_import import default_cache


def test_writable_home_uses_its_cache_folder(tmp_path: Path) -> None:
    assert default_cache(tmp_path) == tmp_path / ".cache" / "unfurl" / "food-data"


def test_home_that_does_not_exist_yet_under_a_writable_parent(tmp_path: Path) -> None:
    home = tmp_path / "new-user"
    assert default_cache(home) == home / ".cache" / "unfurl" / "food-data"


@pytest.mark.skipif(os.geteuid() == 0, reason="root can write anywhere")
def test_read_only_home_falls_back_to_temp(tmp_path: Path) -> None:
    # The production container: home is missing and its parent is not writable.
    parent = tmp_path / "home"
    parent.mkdir()
    parent.chmod(0o555)
    try:
        assert default_cache(parent / "appuser") == (
            Path(tempfile.gettempdir()) / "unfurl-food-data"
        )
    finally:
        parent.chmod(0o755)
