#!/usr/bin/env bash
set -euo pipefail

python -m compileall -q custom/custom_components/etm
python -m json.tool custom/custom_components/etm/manifest.json >/dev/null
python -m json.tool custom/custom_components/etm/translations/en.json >/dev/null
python -m json.tool custom/custom_components/etm/translations/de.json >/dev/null
python scripts/check_hacs_metadata.py

echo "repo_health_check: OK"
