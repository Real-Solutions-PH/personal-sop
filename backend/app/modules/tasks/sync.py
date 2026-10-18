"""Sync registrations for the tasks module (entities + domain actions)."""

from app.modules.sync.registry import Registry


def register(r: Registry) -> None:
    del r  # filled in by the tasks module build
