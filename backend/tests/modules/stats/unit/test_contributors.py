"""The contributor registry under concurrent first use.

The registry is built on the first call. A second request that arrives while
the first is still building must get every contributor, never a half-filled
dict that is still being written to.
"""

import importlib
from types import ModuleType

import pytest

from app.modules.stats import contract


def test_a_call_during_the_first_build_still_sees_every_contributor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(contract, "_contributors", None)
    real = importlib.import_module
    calls = 0
    seen: list[set[str]] = []

    def import_module(name: str, package: str | None = None) -> ModuleType:
        nonlocal calls
        calls += 1
        # Another request arrives mid-build, after the first module is in.
        if calls == 2:
            seen.append(set(contract.contributors()))
        return real(name, package)

    monkeypatch.setattr(importlib, "import_module", import_module)
    first = set(contract.contributors())

    assert first == set(contract.CONTRIBUTOR_MODULES)
    assert seen == [first]
