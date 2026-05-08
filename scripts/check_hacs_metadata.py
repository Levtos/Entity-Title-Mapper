#!/usr/bin/env python3
"""Check HACS-relevant repository structure and metadata for ETM."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(".")
INTEGRATIONS_DIR = ROOT / "custom_components"
INTEGRATION = INTEGRATIONS_DIR / "etm"
MANIFEST = INTEGRATION / "manifest.json"
HACS_JSON = ROOT / "hacs.json"
REQUIRED_MANIFEST_KEYS = {
    "domain",
    "documentation",
    "issue_tracker",
    "codeowners",
    "name",
    "version",
}


def main() -> None:
    """Validate the repository layout and manifest required by HACS."""
    if not INTEGRATION.is_dir():
        raise SystemExit(f"Missing HACS integration directory: {INTEGRATION}")

    integrations = sorted(path.name for path in INTEGRATIONS_DIR.iterdir() if path.is_dir())
    if integrations != ["etm"]:
        raise SystemExit(
            "HACS requires exactly one integration below custom_components/; "
            f"found: {', '.join(integrations) or 'none'}"
        )

    data = json.loads(MANIFEST.read_text())
    missing = sorted(REQUIRED_MANIFEST_KEYS - data.keys())
    if missing:
        msg = f"{MANIFEST} is missing HACS-required keys: {', '.join(missing)}"
        raise SystemExit(msg)

    hacs_data = json.loads(HACS_JSON.read_text())
    if not hacs_data.get("name"):
        raise SystemExit(f"{HACS_JSON} must define a non-empty name")

    print("hacs_structure_check: repository layout OK")
    print("hacs_metadata_check: manifest OK")


if __name__ == "__main__":
    main()
