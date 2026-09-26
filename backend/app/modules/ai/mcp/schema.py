import ipaddress
import socket
import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AfterValidator, ConfigDict, StringConstraints
from sqlmodel import Field, SQLModel

_BLOCKED_HOSTNAMES = {"localhost"}


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _as_ipv4ish(host: str) -> ipaddress.IPv4Address | None:
    """Parse a host the way libc's inet_aton does (decimal/octal/hex/short-form),
    with NO DNS/network call. Catches alt-encoded literals like ``0177.0.0.1``,
    ``127.1`` and ``0x7f000001`` that ``ipaddress.ip_address`` treats as invalid
    but the resolver on the deploy target would happily route to a private IP."""
    try:
        return ipaddress.IPv4Address(socket.inet_aton(host))
    except OSError:
        return None


def _validate_mcp_url(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme != "https":
        raise ValueError("url scheme must be https")
    if parts.username or parts.password:
        raise ValueError("url must not embed credentials")
    host = parts.hostname
    if not host:
        raise ValueError("url must have a host")
    host = host.rstrip(".")  # strip FQDN trailing dot before matching
    if not host:
        raise ValueError("url must have a host")
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address | None
    try:
        ip = ipaddress.ip_address(host)  # canonical v4/v6
    except ValueError:
        ip = _as_ipv4ish(host)  # decimal/octal/hex/short-form v4
    if ip is not None:
        if _is_blocked_ip(ip):
            raise ValueError("url host is a private/reserved address")
        return value
    # genuine DNS name
    lowered = host.lower()
    if lowered in _BLOCKED_HOSTNAMES or lowered.endswith(".localhost"):
        raise ValueError("url host is a loopback name")
    return value


# Length-first alias: StringConstraints runs before AfterValidator, so an
# over-long url fails as ``string_too_long`` (422) before the SSRF check.
MCPServerUrl = Annotated[
    str, StringConstraints(max_length=512), AfterValidator(_validate_mcp_url)
]


class MCPServerConfig(SQLModel):
    """Connection config for an MCP server — WRITE-ONLY end to end.

    Accepted on create/update but absent from every ``*Public`` response, so
    anything it holds (bearer token, auth headers, server-specific secrets)
    can never be echoed back to a client. Known secret-bearing fields are
    typed; ``extra="allow"`` keeps arbitrary server-specific keys accepted and
    equally write-only, so typing does not lock out valid configs.
    """

    model_config = ConfigDict(extra="allow")  # type: ignore[assignment]

    headers: dict[str, str] = {}
    auth_token: str | None = None


class MCPServerBase(SQLModel):
    name: str = Field(max_length=128)
    url: str
    is_active: bool = True


class MCPServerCreate(MCPServerBase):
    url: MCPServerUrl
    config: MCPServerConfig = MCPServerConfig()


class MCPServerUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=128)
    url: MCPServerUrl | None = None
    config: MCPServerConfig | None = None
    is_active: bool | None = None


class MCPServerPublic(MCPServerBase):
    id: uuid.UUID
    created_at: datetime | None = None


class MCPServersPublic(SQLModel):
    data: list[MCPServerPublic]
    count: int
