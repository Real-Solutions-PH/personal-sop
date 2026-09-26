#!/usr/bin/env python3
"""License gate: fail on denylisted licenses in shipped dependencies (constitution §3.7).

Reads license JSON from stdin and exits 1 if any package's license string
contains a denylisted pattern (case-insensitive substring match, so dual
licenses like "GNU AFFERO GPL 3.0 or Commercial" are caught).

Accepts both input shapes:
  - pip-licenses:    [{"Name": "pkg", "License": "MIT", ...}, ...]
  - license-checker: {"pkg@1.0.0": {"licenses": "MIT", ...}, ...}

Denylist and allowlist live in license-denylist.json next to this script.
"""

import json
import sys
from pathlib import Path

CONFIG = Path(__file__).parent / "license-denylist.json"


def strip_npm_version(key: str) -> str:
    """'@scope/name@1.0.0' -> '@scope/name'; 'name@1.0.0' -> 'name'."""
    at = key.rfind("@")
    return key[:at] if at > 0 else key


def normalize(data) -> list[tuple[str, str]]:
    """Return (name, license_string) pairs from either input shape."""
    if isinstance(data, list):  # pip-licenses
        return [(pkg["Name"], str(pkg.get("License", "UNKNOWN"))) for pkg in data]
    pairs = []  # license-checker: dict keyed "name@version"
    for key, info in data.items():
        lic = info.get("licenses", "UNKNOWN")
        if isinstance(lic, list):
            lic = " OR ".join(str(item) for item in lic)
        pairs.append((strip_npm_version(key), str(lic)))
    return pairs


def check(pairs, deny_patterns, allow_packages) -> list[tuple[str, str]]:
    return [
        (name, lic)
        for name, lic in pairs
        if name not in allow_packages
        and any(pattern.upper() in lic.upper() for pattern in deny_patterns)
    ]


def self_test() -> None:
    deny = ["AGPL", "AFFERO", "SUL-1"]
    allow = ["app"]
    # 1. AGPL variant hidden in a dual-license string is caught
    caught = check(
        normalize(
            [
                {
                    "Name": "pymupdf",
                    "License": "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License",
                }
            ]
        ),
        deny,
        allow,
    )
    assert caught == [
        ("pymupdf", "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License")
    ], caught
    # 2. Allowlisted package is skipped (license-checker shape, scoped name)
    assert (
        check(normalize({"app@0.1.0": {"licenses": "AGPL-3.0-only"}}), deny, allow)
        == []
    )
    # 3. Clean list passes
    assert (
        check(
            normalize({"@scope/pkg@1.0.0": {"licenses": ["MIT", "BSD-3-Clause"]}}),
            deny,
            allow,
        )
        == []
    )
    print("self-test OK")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    config = json.loads(CONFIG.read_text())
    pairs = normalize(json.load(sys.stdin))
    violations = check(pairs, config["deny_patterns"], config["allow_packages"])
    if violations:
        print(
            "License gate FAILED — denylisted licenses found (see scripts/license-denylist.json):"
        )
        for name, lic in violations:
            print(f"  {name}: {lic}")
        return 1
    print(
        f"License gate passed: {len(pairs)} packages checked, no denylisted licenses."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
