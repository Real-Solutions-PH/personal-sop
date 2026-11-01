"""Every test signs its users up in a tenant of its own (shared catalog)."""

from tests.utils.tenant import own_tenant

__all__ = ["own_tenant"]
