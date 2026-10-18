"""Sync registrations for the finance module (entities + domain actions)."""

from app.modules.sync.registry import Registry


def register(r: Registry) -> None:
    del r  # filled in by the finance module build
