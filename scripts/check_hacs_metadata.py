#!/usr/bin/env python3
"""Check HACS-relevant metadata for the ETM integration."""

from __future__ import annotations

import json
from pathlib import Path

MANIFEST = Path("custom/custom_components/etm/manifest.json")
REQUIRED_MANIFEST_KEYS = {
    "domain",
    "documentation",
    "issue_tracker",
    "codeowners",
    "name",
    "version",
}


def main() -> None:
    """Validate the integration manifest contains HACS-required metadata."""
    data = json.loads(MANIFEST.read_text())
    missing = sorted(REQUIRED_MANIFEST_KEYS - data.keys())
    if missing:
        msg = f"{MANIFEST} is missing HACS-required keys: {', '.join(missing)}"
        raise SystemExit(msg)

    print("hacs_metadata_check: manifest OK")


if __name__ == "__main__":
    main()
