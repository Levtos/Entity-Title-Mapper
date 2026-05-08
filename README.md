# Entity Title Mapper

Entity Title Mapper (ETM) is a Home Assistant custom integration that observes
configured source entities, persists observed key strings, and exposes a mapped
numeric enum sensor plus the current raw key for automations.

See [`docs/ETM.md`](docs/ETM.md) for usage details and [`docs/HACS.md`](docs/HACS.md)
for HACS compatibility notes.

## HACS

This repository uses the HACS integration layout: `custom_components/etm/` at the repository root, plus root-level `hacs.json` metadata. Binary brand assets are intentionally not committed to this repository.
