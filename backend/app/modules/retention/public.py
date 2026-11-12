"""Cross-module contract of the retention module."""

from app.modules.retention.sender import record_open

__all__ = ["record_open"]
